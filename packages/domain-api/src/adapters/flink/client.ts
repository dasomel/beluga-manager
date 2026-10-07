// Flink JobManager REST 클라이언트 — 읽기 전용(GET만) 경계. 문서(Flink 1.20):
// https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/
// 사용 endpoint: GET /overview, GET /jobs/overview, GET /jobs/{jobid}.
// 이 모듈은 어떤 변경성 요청(POST/PATCH/DELETE, job cancel/savepoint 등)도 만들 수 없게
// 요청 메서드와 경로 집합을 고정한다. 오류는 FlinkClientError로 분류해서 던지고, 호출자(adapter)가
// 이를 health/warning으로 낮춘다 — route까지 전파되지 않는다.
import { z } from "@hono/zod-openapi";

export type FlinkErrorKind = "unreachable" | "timeout" | "http-error" | "invalid-response";

export class FlinkClientError extends Error {
  constructor(
    readonly kind: FlinkErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FlinkClientError";
  }
}

// 응답 본문 상한: 정상 응답(jobs/{id}는 plan 포함)은 수 KB지만 오작동/악성 응답이 메모리를
// 쓰지 못하게 한다.
const MAX_BODY_CHARS = 2 * 1024 * 1024;

// Flink는 알 수 없는 상태 문자열이 추가될 수 있으므로 state는 enum이 아니라 string으로 받고
// 매핑 표에서 보수적으로 처리한다(mapping.ts).
const epochMs = z.number().finite();

export const flinkOverviewSchema = z.object({
  "flink-version": z.string().min(1),
  taskmanagers: z.number().int().nonnegative(),
  "slots-total": z.number().int().nonnegative(),
  "slots-available": z.number().int().nonnegative(),
  "jobs-running": z.number().int().nonnegative(),
});

export const flinkJobSummarySchema = z.object({
  jid: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().min(1),
  state: z.string().min(1),
  "start-time": epochMs,
  "end-time": epochMs,
  "last-modification": epochMs,
  tasks: z.record(z.string(), z.number()).default({}),
});

export const flinkJobsOverviewSchema = z.object({ jobs: z.array(flinkJobSummarySchema) });

export const flinkJobDetailSchema = z.object({
  jid: z.string().regex(/^[0-9a-f]{32}$/),
  state: z.string().min(1),
  vertices: z.array(z.object({ name: z.string(), status: z.string() })).default([]),
});

export type FlinkOverview = z.infer<typeof flinkOverviewSchema>;
export type FlinkJobSummary = z.infer<typeof flinkJobSummarySchema>;
export type FlinkJobDetail = z.infer<typeof flinkJobDetailSchema>;

export interface FlinkClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class FlinkRestClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FlinkClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getOverview(): Promise<FlinkOverview> {
    return this.get("/overview", flinkOverviewSchema);
  }

  async getJobsOverview(): Promise<FlinkJobSummary[]> {
    return (await this.get("/jobs/overview", flinkJobsOverviewSchema)).jobs;
  }

  getJob(jobId: string): Promise<FlinkJobDetail> {
    // 경로 보간 전에 형식을 고정한다 — upstream이 돌려준 jid가 경로를 바꾸지 못하게 한다.
    if (!/^[0-9a-f]{32}$/.test(jobId)) {
      throw new FlinkClientError("invalid-response", "Job id is not a 32-character hex string");
    }
    return this.get(`/jobs/${jobId}`, flinkJobDetailSchema);
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
      } catch (err) {
        throw this.classifyTransport(err, controller.signal);
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => {});
        throw new FlinkClientError("http-error", `Flink REST ${path} returned HTTP ${res.status}`, res.status);
      }
      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        throw this.classifyTransport(err, controller.signal);
      }
      if (text.length > MAX_BODY_CHARS) {
        throw new FlinkClientError("invalid-response", `Flink REST ${path} response exceeds ${MAX_BODY_CHARS} characters`);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new FlinkClientError("invalid-response", `Flink REST ${path} returned malformed JSON`);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new FlinkClientError("invalid-response", `Flink REST ${path} returned an unexpected shape`);
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }

  private classifyTransport(err: unknown, signal: AbortSignal): FlinkClientError {
    if (signal.aborted) {
      return new FlinkClientError("timeout", `Flink REST did not respond within ${this.options.timeoutMs}ms`);
    }
    // 내부 호스트/오류 세부사항은 메시지에 싣지 않는다.
    void err;
    return new FlinkClientError("unreachable", "Flink REST is unreachable");
  }
}
