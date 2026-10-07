import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { FlinkAdapter } from "../src/adapters/flink/adapter.js";
import { FlinkClientError, FlinkRestClient } from "../src/adapters/flink/client.js";
import { FLINK_STATE_MAPPING, mapState } from "../src/adapters/flink/mapping.js";
import { createRuntime } from "../src/adapters/runtime.js";
import { createApp } from "../src/app.js";
import { ConfigError, DEFAULT_FLINK_TIMEOUT_MS, loadFlinkAdapterConfig } from "../src/config.js";
import { listResponseSchema } from "../src/schema/envelope.js";
import { pipelineSchema } from "../src/schema/pipeline.js";
import { services } from "../src/stub-data/services.js";

// 픽스처: *.synthetic.json을 제외한 파일은 Flink 1.20.0 실제 클러스터에서 읽기 전용으로 녹화한 응답이다
// (tests/fixtures/flink-1.20/README.md).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/flink-1.20/${name}`, import.meta.url)), "utf8"));

const config = { baseUrl: "http://flink.test:8081", timeoutMs: 200, jobNamePrefix: "beluga-" };
const NOW = new Date("2026-10-07T00:00:00.000Z");
const JIDS = {
  orders: "e4ce0083a91b9378cd054e129326abf7",
  customers: "5ec600a747e2a2be1d5bc75b6d5a98ad",
  events: "e1c03f689440a936a1ff5304c6934440",
} as const;

interface Routes {
  overview?: unknown;
  jobs?: unknown;
  details?: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function recordedFetch(routes: Routes, seen: Array<{ method: string; path: string }> = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    seen.push({ method: init?.method ?? "GET", path });
    if (path === "/overview") return json(routes.overview ?? fixture("overview.json"));
    if (path === "/jobs/overview") return json(routes.jobs ?? fixture("jobs-overview.json"));
    const jid = path.replace("/jobs/", "");
    const detail = routes.details?.[jid];
    return detail === undefined ? json({ errors: ["not found"] }, 404) : json(detail);
  }) as typeof fetch;
}

const liveDetails = {
  [JIDS.orders]: fixture("job-cdc_orders.json"),
  [JIDS.customers]: fixture("job-cdc_customers.json"),
  [JIDS.events]: fixture("job-events_sessionization.json"),
};

function adapterWith(fetchImpl: typeof fetch, overrides: Partial<typeof config> = {}) {
  return new FlinkAdapter({ config: { ...config, ...overrides }, fetchImpl, now: () => NOW });
}

test("녹화된 RUNNING job 3개가 job당 하나의 Pipeline으로 매핑되고 스키마를 통과한다", async () => {
  const { pipelines, warnings } = await adapterWith(recordedFetch({ details: liveDetails })).listPipelines();

  expect(warnings).toEqual([]);
  expect(pipelines.map((p) => p.id)).toEqual([
    "pl-flink-beluga-cdc-customers",
    "pl-flink-beluga-cdc-orders",
    "pl-flink-beluga-events-sessionization",
  ]);
  for (const p of pipelines) {
    expect(() => pipelineSchema.parse(p)).not.toThrow();
    expect(p.status).toBe("healthy");
    expect(p.jobs[0]).toMatchObject({ kind: "flink", serviceId: "svc-flink", lastRun: { result: "running", finishedAt: null, failureReason: null } });
    expect(p.correlation.method).toBe("inferred");
  }
  const orders = pipelines.find((p) => p.name === "beluga-cdc_orders")!;
  expect(orders.jobs[0]!.id).toBe(`job-flink-${JIDS.orders}`);
  expect(orders.jobs[0]!.lastRun!.startedAt).toBe(new Date(1791368356575).toISOString());
  expect(orders.stages.map((s) => [s.serviceType, s.status])).toEqual([["flink", "healthy"], ["iceberg", "unknown"]]);
});

test("job->table 링크는 이름 규약(0.6)이며 declared로 위조되지 않고 Flink job graph 근거를 포함한다", async () => {
  const { pipelines } = await adapterWith(recordedFetch({ details: liveDetails })).listPipelines();

  const byName = Object.fromEntries(pipelines.map((p) => [p.name, p]));
  const expected = {
    "beluga-cdc_orders": "lakekeeper.lake.orders",
    "beluga-cdc_customers": "lakekeeper.lake.customers",
    "beluga-events_sessionization": "lakekeeper.lake.events_enriched",
  };
  for (const [name, table] of Object.entries(expected)) {
    const links = byName[name]!.correlationLinks;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ relation: "job-writes-table", method: "name-convention", confidence: 0.6 });
    expect(links[0]!.evidence.join(" ")).toContain(`IcebergSink on '${table}'`);
    expect(byName[name]!.correlation.confidence).toBe(0.6);
  }
  // Kafka topic은 Flink REST가 노출하지 않으므로 topic->job 링크는 만들지 않는다.
  expect(pipelines.flatMap((p) => p.correlationLinks).some((l) => l.relation === "topic-feeds-job")).toBe(false);
});

test("RESTARTING job은 degraded이고 실행 결과는 unknown, 실패 사유는 상태 이름만 담는다", async () => {
  const jobs = fixture("jobs-overview.restarting.synthetic.json");
  const details = { [JIDS.orders]: fixture("job-cdc_orders.restarting.synthetic.json") };
  const { pipelines } = await adapterWith(recordedFetch({ jobs, details })).listPipelines();

  expect(pipelines).toHaveLength(1);
  expect(pipelines[0]!.status).toBe("degraded");
  expect(pipelines[0]!.jobs[0]!.lastRun).toMatchObject({ result: "unknown", failureReason: "Flink reported job state RESTARTING" });
});

test("FAILED job은 unavailable/failed이고 종료 시각을 담는다", async () => {
  const jobs = fixture("jobs-overview.failed.synthetic.json");
  const { pipelines } = await adapterWith(recordedFetch({ jobs })).listPipelines();

  expect(pipelines[0]!.status).toBe("unavailable");
  const lastRun = pipelines[0]!.jobs[0]!.lastRun!;
  expect(lastRun.result).toBe("failed");
  expect(lastRun.finishedAt).not.toBeNull();
});

test("상태 매핑 표: 알 수 없는 상태와 failed task가 있는 RUNNING은 보수적으로 매핑된다", () => {
  expect(Object.keys(FLINK_STATE_MAPPING).sort()).toEqual(
    ["CANCELED", "CANCELLING", "CREATED", "FAILED", "FAILING", "FINISHED", "INITIALIZING", "RECONCILING", "RESTARTING", "RUNNING", "SUSPENDED"],
  );
  expect(mapState("SOMETHING_NEW")).toEqual({ health: "unknown", result: "unknown" });
  expect(mapState("RUNNING", { failed: 1 })).toEqual({ health: "degraded", result: "running" });
  expect(mapState("RUNNING", { failed: 0 }).health).toBe("healthy");
  // healthy는 RUNNING과 FINISHED뿐이다.
  expect(Object.entries(FLINK_STATE_MAPPING).filter(([, m]) => m.health === "healthy").map(([s]) => s).sort()).toEqual(["FINISHED", "RUNNING"]);
});

test("JobManager에 연결할 수 없으면 throw하지 않고 unknown/경고로 낮춘다", async () => {
  const refused = (async () => { throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.9:8081"); }) as typeof fetch;
  const adapter = adapterWith(refused);
  vi.spyOn(console, "warn").mockImplementation(() => {});

  expect((await adapter.getHealth()).status).toBe("unknown");
  expect(await adapter.getVersion()).toBeNull();
  expect((await adapter.getMetadata()).keyMetrics).toEqual([]);
  const snapshot = await adapter.listPipelines();
  expect(snapshot.pipelines).toEqual([]);
  expect(snapshot.warnings).toEqual([{ code: "UPSTREAM_UNAVAILABLE", message: expect.stringContaining("unreachable"), serviceId: "svc-flink" }]);
  expect(JSON.stringify(snapshot)).not.toContain("10.0.0.9");
});

test("route는 JobManager가 내려가 있어도 200과 경고를 반환한다", async () => {
  const refused = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createApp(undefined, undefined, adapterWith(refused));
  const res = await app.request("/api/v1/pipelines");

  expect(res.status).toBe(200);
  const body = listResponseSchema(pipelineSchema, "PipelineListFlinkDown").parse(await res.json());
  expect(body.data).toEqual([]);
  expect(body.warnings?.[0]?.code).toBe("UPSTREAM_UNAVAILABLE");
});

test("route는 라이브 Pipeline을 목록/상세로 제공하고 없는 id는 404이다", async () => {
  const app = createApp(undefined, undefined, adapterWith(recordedFetch({ details: liveDetails })));
  const list = listResponseSchema(pipelineSchema, "PipelineListFlinkLive").parse(await (await app.request("/api/v1/pipelines")).json());
  expect(list.meta.total).toBe(3);
  expect(list.data.every((p) => p.id.startsWith("pl-flink-"))).toBe(true); // stub과 섞이지 않는다.

  const one = await app.request("/api/v1/pipelines/pl-flink-beluga-cdc-orders");
  expect(one.status).toBe(200);
  expect((await app.request("/api/v1/pipelines/pl-lakehouse-ingest")).status).toBe(404);
});

test("잘못된 JSON과 예상 밖 모양은 invalid-response로 분류된다", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const malformed = (async () => new Response("{not json", { status: 200 })) as typeof fetch;
  const wrongShape = (async () => json({ jobs: [{ jid: "../etc/passwd", name: "x", state: "RUNNING" }] })) as typeof fetch;

  await expect(new FlinkRestClient({ ...config, fetchImpl: malformed }).getJobsOverview()).rejects.toMatchObject({ kind: "invalid-response" });
  await expect(new FlinkRestClient({ ...config, fetchImpl: wrongShape }).getJobsOverview()).rejects.toMatchObject({ kind: "invalid-response" });

  const adapter = adapterWith(malformed);
  expect((await adapter.getHealth()).status).toBe("unknown");
  const snapshot = await adapter.listPipelines();
  expect(snapshot.pipelines).toEqual([]);
  expect(snapshot.warnings[0]!.message).toContain("unexpected response");
});

test("응답이 없으면 timeout으로 분류되고 요청이 abort된다", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let aborted = false;
  const hang = ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    })) as typeof fetch;

  await expect(new FlinkRestClient({ ...config, timeoutMs: 20, fetchImpl: hang }).getOverview()).rejects.toMatchObject({ kind: "timeout" });
  expect(aborted).toBe(true);
  const snapshot = await adapterWith(hang, { timeoutMs: 20 }).listPipelines();
  expect(snapshot.warnings[0]!.message).toContain("did not respond in time");
});

test("HTTP 5xx는 degraded, 4xx는 unknown health이다", async () => {
  const status = (code: number) => (async () => new Response("{}", { status: code })) as typeof fetch;
  expect((await adapterWith(status(503)).getHealth()).status).toBe("degraded");
  expect((await adapterWith(status(404)).getHealth()).status).toBe("unknown");
});

test("정상 JobManager의 service 메타데이터는 live overview에서 온다", async () => {
  const adapter = adapterWith(recordedFetch({}));
  expect(await adapter.getVersion()).toBe("1.20.0");
  expect((await adapter.getHealth()).status).toBe("healthy");
  const meta = await adapter.getMetadata();
  expect(meta.endpoint).toBeNull(); // 내부 REST 주소는 노출하지 않는다.
  expect(meta.keyMetrics.map((m) => m.name)).toEqual(["TaskManagers", "Slots total", "Slots available", "Jobs running"]);
});

test("registry/service route에서 svc-flink가 라이브 어댑터로 대체되고 순서는 유지된다", async () => {
  const { registry, pipelineAdapter } = createRuntime({ BELUGA_FLINK_REST_URL: "http://flink.test:8081" }, recordedFetch({}));
  const listed = await registry.listServices();

  expect(pipelineAdapter).toBeDefined();
  expect(listed.map((s) => s.id)).toEqual(services.map((s) => s.id));
  const flink = listed.find((s) => s.id === "svc-flink")!;
  expect(flink).toMatchObject({ version: "1.20.0", status: "healthy" });
});

test("설정이 없으면 기본은 stub이다(어댑터 비활성)", async () => {
  const { registry, pipelineAdapter } = createRuntime({});
  expect(pipelineAdapter).toBeUndefined();
  expect(await registry.listServices()).toEqual(services);
  expect(loadFlinkAdapterConfig({})).toBeUndefined();
  expect(loadFlinkAdapterConfig({ BELUGA_FLINK_REST_URL: "  " })).toBeUndefined();
});

test("설정 검증: 기본값, 경로/자격증명/스킴/타임아웃 오류는 기동 시점에 거부된다", () => {
  expect(loadFlinkAdapterConfig({ BELUGA_FLINK_REST_URL: "http://flink-cluster-rest.streaming:8081/" })).toEqual({
    baseUrl: "http://flink-cluster-rest.streaming:8081",
    timeoutMs: DEFAULT_FLINK_TIMEOUT_MS,
    jobNamePrefix: "beluga-",
  });
  const bad = (env: Record<string, string>) => () => loadFlinkAdapterConfig(env);
  expect(bad({ BELUGA_FLINK_REST_URL: "not a url" })).toThrow(ConfigError);
  expect(bad({ BELUGA_FLINK_REST_URL: "ftp://x" })).toThrow(/http or https/);
  expect(bad({ BELUGA_FLINK_REST_URL: "http://u:p@x:8081" })).toThrow(/credentials/);
  expect(bad({ BELUGA_FLINK_REST_URL: "http://x:8081/jobs" })).toThrow(/bare origin/);
  expect(bad({ BELUGA_FLINK_REST_URL: "http://x:8081", BELUGA_FLINK_TIMEOUT_MS: "0" })).toThrow(/TIMEOUT/);
  expect(bad({ BELUGA_FLINK_REST_URL: "http://x:8081", BELUGA_FLINK_TIMEOUT_MS: "abc" })).toThrow(/TIMEOUT/);
});

test("읽기 전용: GET만, 허용된 경로만 호출하고 변경성 endpoint는 호출하지 않는다", async () => {
  const seen: Array<{ method: string; path: string }> = [];
  const adapter = adapterWith(recordedFetch({ details: liveDetails }, seen));
  await adapter.listPipelines();
  await adapter.getHealth();

  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((r) => r.method === "GET")).toBe(true);
  expect(seen.every((r) => r.path === "/overview" || r.path === "/jobs/overview" || /^\/jobs\/[0-9a-f]{32}$/.test(r.path))).toBe(true);
});

test("jid가 경로를 바꾸려 하면 요청 전에 거부된다", () => {
  const client = new FlinkRestClient({ ...config, fetchImpl: (() => { throw new Error("must not be called"); }) as typeof fetch });
  expect(() => client.getJob("../../cluster")).toThrow(FlinkClientError);
});

test("job 상세 조회가 실패해도 job은 투영되고 PARTIAL 경고가 붙는다", async () => {
  const { pipelines, warnings } = await adapterWith(recordedFetch({ details: { [JIDS.orders]: liveDetails[JIDS.orders] } })).listPipelines();

  expect(pipelines).toHaveLength(3);
  expect(warnings.map((w) => w.code)).toEqual(["PARTIAL"]);
  const customers = pipelines.find((p) => p.name === "beluga-cdc_customers")!;
  expect(customers.correlationLinks).toEqual([]);
  expect(customers.correlation.confidence).toBe(0.3);
  expect(customers.stages).toHaveLength(1);
});

test("같은 이름의 job이 둘이면 jid 접두어로 Pipeline id를 구분한다", async () => {
  const base = (fixture("jobs-overview.json") as { jobs: Array<Record<string, unknown>> }).jobs[0]!;
  const jobs = { jobs: [base, { ...base, jid: "a".repeat(32) }] };
  const { pipelines } = await adapterWith(recordedFetch({ jobs })).listPipelines();

  expect(new Set(pipelines.map((p) => p.id)).size).toBe(2);
  expect(pipelines.map((p) => p.id).sort()).toEqual(["pl-flink-beluga-cdc-orders-aaaaaaaa", "pl-flink-beluga-cdc-orders-e4ce0083"]);
});
