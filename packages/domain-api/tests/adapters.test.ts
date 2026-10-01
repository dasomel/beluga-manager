import { afterEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  DuplicateAdapterError,
  ServiceAdapterRegistry,
  UnsupportedAdapterVersionError,
} from "../src/adapters/registry.js";
import { createStubAdapter, createStubRegistry } from "../src/adapters/stubAdapter.js";
import type { ServiceAdapter } from "../src/adapters/types.js";
import { listResponseSchema } from "../src/schema/envelope.js";
import { serviceSchema } from "../src/schema/service.js";
import { services } from "../src/stub-data/services.js";

const listSchema = listResponseSchema(serviceSchema, "ServiceListResponseAdapterTest");

afterEach(() => {
  vi.restoreAllMocks();
});

function failing(base: ServiceAdapter, method: "getMetadata" | "getVersion" | "getHealth"): ServiceAdapter {
  return { ...base, [method]: async () => { throw new Error("upstream boom at 10.0.0.1"); } };
}

test("스텁 레지스트리는 stub-data를 인터페이스를 통해 그대로(순서 포함) 돌려준다", async () => {
  const listed = await createStubRegistry().listServices();

  expect(listed).toEqual(services);
});

test("getService는 id로 조회하고 없으면 undefined를 반환한다", async () => {
  const registry = createStubRegistry();

  expect((await registry.getService("svc-trino"))?.id).toBe("svc-trino");
  expect(await registry.getService("nope")).toBeUndefined();
});

test("지원하지 않는 계약 버전의 어댑터 등록은 명확한 오류로 거부된다", () => {
  const adapter = { ...createStubAdapter(services[0]!), contractVersion: 99 };

  expect(() => new ServiceAdapterRegistry().register(adapter)).toThrow(UnsupportedAdapterVersionError);
  expect(() => new ServiceAdapterRegistry().register(adapter)).toThrow(
    "Adapter 'svc-trino' declares contract version 99; supported versions: 1",
  );
});

test("같은 id의 어댑터를 중복 등록하면 거부된다", () => {
  const adapter = createStubAdapter(services[0]!);

  expect(() => new ServiceAdapterRegistry([adapter, adapter])).toThrow(DuplicateAdapterError);
});

test.each(["getMetadata", "getVersion", "getHealth"] as const)(
  "%s가 던지면 해당 서비스만 unknown으로 낮아지고 나머지 목록은 유지된다",
  async (method) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [first, second, ...rest] = services.map(createStubAdapter);
    const registry = new ServiceAdapterRegistry([failing(first!, method), second!, ...rest]);

    const listed = await registry.listServices();

    expect(listed).toHaveLength(services.length);
    expect(listed[0]).toMatchObject({ id: "svc-trino", name: "Trino", type: "trino", status: "unknown", version: null });
    expect(() => serviceSchema.parse(listed[0])).not.toThrow();
    expect(listed.slice(1)).toEqual(services.slice(1));
  },
);

test("GET /api/v1/services는 어댑터 하나가 실패해도 200이고 해당 서비스만 unknown + warning이다", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const adapters = services.map(createStubAdapter).map((a) => (a.id === "svc-airflow" ? failing(a, "getHealth") : a));
  const app = createApp(new ServiceAdapterRegistry(adapters));

  const res = await app.request("/api/v1/services?type=airflow");
  expect(res.status).toBe(200);
  const body = listSchema.parse(await res.json());

  expect(body.data).toHaveLength(1);
  expect(body.data[0]?.status).toBe("unknown");
  expect(body.warnings).toEqual([{ code: "UNKNOWN", message: "Airflow status is unknown", serviceId: "svc-airflow" }]);
  // 내부 오류 세부사항은 응답에 노출되지 않는다.
  expect(JSON.stringify(body)).not.toContain("10.0.0.1");

  const all = await app.request("/api/v1/services");
  expect(all.status).toBe(200);
  expect(listSchema.parse(await all.json()).meta.total).toBe(services.length);
});
