// Flink JobManager 읽기 전용 어댑터(이슈 #16/#35/#41). ServiceAdapter(svc-flink)와 PipelineAdapter를 함께 구현한다.
// 설정이 없으면 만들어지지 않는다(config.ts) — 기본은 stub. 어떤 메서드도 throw하지 않는다.
import type { FlinkAdapterConfig } from "../../config.js";
import type { ListWarning } from "../../schema/envelope.js";
import type { HealthStatus } from "../../schema/health.js";
import type { AdapterHealth, AdapterMetadata, ServiceAdapter } from "../types.js";
import type { PipelineAdapter, PipelineSnapshot } from "../pipelineAdapter.js";
import { FlinkClientError, FlinkRestClient, type FlinkJobDetail, type FlinkOverview } from "./client.js";
import { buildPipelines, FLINK_SERVICE_ID, type FlinkJobInput } from "./mapping.js";

// D1: 상세 조회(/jobs/{id}) 상한. 오래된 job 이력이 많은 클러스터에서 요청 폭주를 막는다.
const MAX_JOBS = 100;
const DETAIL_CONCURRENCY = 8;
// D2: 마지막 확인으로부터 이 시간이 지나면 클라이언트가 stale로 취급한다(stub의 60s와 같은 규모).
const STALE_AFTER_MS = 60_000;

export interface FlinkAdapterOptions {
  config: FlinkAdapterConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class FlinkAdapter implements ServiceAdapter, PipelineAdapter {
  readonly id = FLINK_SERVICE_ID;
  readonly name = "Flink";
  readonly type = "flink" as const;
  readonly contractVersion = 1;

  private readonly client: FlinkRestClient;
  private readonly now: () => Date;
  private inflightOverview: Promise<FlinkOverview> | undefined;

  constructor(private readonly options: FlinkAdapterOptions) {
    this.client = new FlinkRestClient({
      baseUrl: options.config.baseUrl,
      timeoutMs: options.config.timeoutMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.now = options.now ?? (() => new Date());
  }

  // registry가 metadata/version/health를 병렬로 부르므로 동시 호출은 한 번의 요청을 공유한다.
  private overview(): Promise<FlinkOverview> {
    if (!this.inflightOverview) {
      const p = this.client.getOverview();
      this.inflightOverview = p;
      const clear = () => {
        if (this.inflightOverview === p) this.inflightOverview = undefined;
      };
      p.then(clear, clear);
    }
    return this.inflightOverview;
  }

  async getMetadata(): Promise<AdapterMetadata> {
    const base: AdapterMetadata = {
      endpoint: null, // 내부 REST 주소는 노출하지 않는다.
      capabilities: ["job.list"],
      capabilityCategories: ["processing"],
      namespace: null,
      workloadRef: null,
      keyMetrics: [],
      dependencies: [],
    };
    try {
      const o = await this.overview();
      const metric = (name: string, value: number) => ({ name, value: String(value), unit: null });
      return {
        ...base,
        keyMetrics: [
          metric("TaskManagers", o.taskmanagers),
          metric("Slots total", o["slots-total"]),
          metric("Slots available", o["slots-available"]),
          metric("Jobs running", o["jobs-running"]),
        ],
      };
    } catch {
      return base;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      return (await this.overview())["flink-version"];
    } catch {
      return null;
    }
  }

  async getHealth(): Promise<AdapterHealth> {
    let status: HealthStatus;
    try {
      await this.overview();
      status = "healthy";
    } catch (err) {
      status = healthFor(err);
    }
    return { status, lastCheckedAt: this.now().toISOString(), staleAfterMs: STALE_AFTER_MS };
  }

  async listPipelines(): Promise<PipelineSnapshot> {
    const warnings: ListWarning[] = [];
    let summaries;
    try {
      summaries = await this.client.getJobsOverview();
    } catch (err) {
      return { pipelines: [], warnings: [warningFor(err)] };
    }

    const selected = summaries.slice(0, MAX_JOBS);
    if (summaries.length > selected.length) {
      warnings.push({
        code: "TRUNCATED",
        message: `Flink reports ${summaries.length} jobs; only the first ${MAX_JOBS} are shown`,
        serviceId: FLINK_SERVICE_ID,
      });
    }

    const details = await mapLimited(selected, DETAIL_CONCURRENCY, async (s): Promise<FlinkJobDetail | undefined> => {
      try {
        return await this.client.getJob(s.jid);
      } catch {
        return undefined;
      }
    });
    const inputs: FlinkJobInput[] = selected.map((summary, i) => {
      const detail = details[i];
      return detail ? { summary, detail } : { summary };
    });
    const missing = details.filter((d) => d === undefined).length;
    if (missing > 0) {
      warnings.push({
        code: "PARTIAL",
        message: `Flink job details were unavailable for ${missing} job(s); their sink tables are not shown`,
        serviceId: FLINK_SERVICE_ID,
      });
    }

    const { pipelines, skipped } = buildPipelines(inputs, {
      jobNamePrefix: this.options.config.jobNamePrefix,
      now: this.now(),
    });
    if (skipped > 0) {
      warnings.push({
        code: "INVALID_JOB",
        message: `${skipped} Flink job(s) could not be mapped to a Pipeline and were skipped`,
        serviceId: FLINK_SERVICE_ID,
      });
    }
    return { pipelines, warnings };
  }
}

// unreachable/timeout은 우리 쪽에서 관측할 수 없다는 뜻이지 서비스가 내려갔다는 증거가 아니므로
// unknown이다. 5xx는 응답은 하지만 오류이므로 degraded. 그 밖의 비정상 응답은 unknown.
function healthFor(err: unknown): HealthStatus {
  if (err instanceof FlinkClientError && err.kind === "http-error" && (err.status ?? 0) >= 500) return "degraded";
  return "unknown";
}

function warningFor(err: unknown): ListWarning {
  const kind = err instanceof FlinkClientError ? err.kind : "unreachable";
  const messages: Record<string, string> = {
    unreachable: "Flink JobManager is unreachable; live pipelines are unavailable",
    timeout: "Flink JobManager did not respond in time; live pipelines are unavailable",
    "http-error": "Flink JobManager returned an error response; live pipelines are unavailable",
    "invalid-response": "Flink JobManager returned an unexpected response; live pipelines are unavailable",
  };
  console.warn(`Flink adapter: listPipelines failed (${kind})`);
  return { code: "UPSTREAM_UNAVAILABLE", message: messages[kind] ?? messages["unreachable"]!, serviceId: FLINK_SERVICE_ID };
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
