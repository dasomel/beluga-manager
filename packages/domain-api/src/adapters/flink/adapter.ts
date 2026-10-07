// Flink JobManager 읽기 전용 어댑터(이슈 #16/#35/#41). ServiceAdapter(svc-flink)와 PipelineAdapter를 함께 구현한다.
// 설정이 없으면 만들어지지 않는다(config.ts) — 기본은 stub. 어떤 메서드도 throw하지 않는다.
import type { FlinkAdapterConfig } from "../../config.js";
import type { ListWarning } from "../../schema/envelope.js";
import type { HealthStatus } from "../../schema/health.js";
import type { AdapterHealth, AdapterMetadata, ServiceAdapter } from "../types.js";
import type { PipelineAdapter, PipelineLookup, PipelineSnapshot } from "../pipelineAdapter.js";
import { FlinkClientError, FlinkRestClient, type FlinkJobDetail, type FlinkJobSummary, type FlinkOverview } from "./client.js";
import { buildPipelines, FLINK_SERVICE_ID, PIPELINE_ID_PATTERN, type FlinkJobInput } from "./mapping.js";

// D1: 상세 조회(/jobs/{id}) 상한. 오래된 job 이력이 많은 클러스터에서 요청 폭주를 막는다.
const MAX_JOBS = 100;
// D2: 마지막 확인으로부터 이 시간이 지나면 클라이언트가 stale로 취급한다(stub의 60s와 같은 규모).
const STALE_AFTER_MS = 60_000;

export interface FlinkAdapterOptions {
  config: FlinkAdapterConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

// 단일 비행(single-flight) + 짧은 TTL 캐시. 동시에 들어온 호출은 하나의 진행 중 작업을 공유하고,
// 성공은 ttlMs, 실패는 negativeTtlMs 동안 재사용한다(실패 직후 재시도 폭주 방지).
class SingleFlightCache<T> {
  private entry: { at: number; result: { ok: true; value: T } | { ok: false; error: unknown } } | undefined;
  private inflight: Promise<T> | undefined;

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => number,
    private readonly negativeTtlMs = 0,
  ) {}

  peekFresh(): T | undefined {
    const e = this.entry;
    return e && e.result.ok && this.clock() - e.at < this.ttlMs ? e.result.value : undefined;
  }

  get(load: () => Promise<T>): Promise<T> {
    const e = this.entry;
    if (e) {
      const age = this.clock() - e.at;
      if (e.result.ok && age < this.ttlMs) return Promise.resolve(e.result.value);
      if (!e.result.ok && age < this.negativeTtlMs) return Promise.reject(e.result.error);
    }
    if (!this.inflight) {
      const p = load().then(
        (value) => {
          this.entry = { at: this.clock(), result: { ok: true, value } };
          return value;
        },
        (error: unknown) => {
          this.entry = { at: this.clock(), result: { ok: false, error } };
          throw error;
        },
      );
      this.inflight = p;
      const clear = () => {
        if (this.inflight === p) this.inflight = undefined;
      };
      p.then(clear, clear);
    }
    return this.inflight;
  }
}

// 키별 SingleFlightCache를 LRU로 제한한다. 키는 외부 입력(jid)에서 오므로 크기가 무한히 자라지 않게 한다.
class BoundedKeyedCache<T> {
  private readonly map = new Map<string, SingleFlightCache<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly make: () => SingleFlightCache<T>,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    let cache = this.map.get(key);
    if (cache) this.map.delete(key); // 최근 사용 순서로 재삽입
    else cache = this.make();
    this.map.set(key, cache);
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string);
    return cache.get(load);
  }
}

// D4: by-id 경로의 job 상세 캐시 항목 수 상한(LRU). 요청이 존재하는 job의 jid만 키로 쓰지만 그래도 제한한다.
const DETAIL_CACHE_MAX_ENTRIES = 256;
// 실패는 짧게만(최대 1s) 기억한다.
const NEGATIVE_TTL_CAP_MS = 1000;

export class FlinkAdapter implements ServiceAdapter, PipelineAdapter {
  readonly id = FLINK_SERVICE_ID;
  readonly name = "Flink";
  readonly type = "flink" as const;
  readonly contractVersion = 1;

  private readonly client: FlinkRestClient;
  private readonly now: () => Date;
  private readonly overviewCache: SingleFlightCache<FlinkOverview>;
  private readonly snapshotCache: SingleFlightCache<PipelineSnapshot>;
  // GET-by-id 전용: job 목록(요약)과 job별 상세를 단일 비행 + 짧은 TTL로 공유한다.
  private readonly summariesCache: SingleFlightCache<FlinkJobSummary[]>;
  private readonly detailCache: BoundedKeyedCache<FlinkJobDetail>;

  constructor(private readonly options: FlinkAdapterOptions) {
    const { config } = options;
    this.client = new FlinkRestClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      maxConcurrency: config.maxConcurrency,
      maxQueue: config.maxQueue,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.now = options.now ?? (() => new Date());
    const clock = () => this.now().getTime();
    this.overviewCache = new SingleFlightCache(config.cacheTtlMs, clock);
    this.snapshotCache = new SingleFlightCache(config.cacheTtlMs, clock);
    const negative = Math.min(config.cacheTtlMs, NEGATIVE_TTL_CAP_MS);
    this.summariesCache = new SingleFlightCache(config.cacheTtlMs, clock, negative);
    this.detailCache = new BoundedKeyedCache(DETAIL_CACHE_MAX_ENTRIES, () => new SingleFlightCache(config.cacheTtlMs, clock, negative));
  }

  // registry가 metadata/version/health를 병렬로 부르므로 하나의 요청을 공유하고 TTL 동안 재사용한다.
  private overview(): Promise<FlinkOverview> {
    return this.overviewCache.get(() => this.client.getOverview());
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

  // 한 번의 구성은 1 /jobs/overview + 최대 MAX_JOBS개의 /jobs/{id}이며, 동시 호출은 합쳐지고 TTL 동안 캐시된다.
  listPipelines(): Promise<PipelineSnapshot> {
    return this.snapshotCache.get(() => this.buildSnapshot());
  }

  private async buildSnapshot(): Promise<PipelineSnapshot> {
    const warnings: ListWarning[] = [];
    // 전체 시간 예산: 초과하면 진행 중/대기 중 요청을 abort하고 읽은 만큼만 반환한다.
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), this.options.config.snapshotBudgetMs);
    try {
      let summaries: FlinkJobSummary[];
      try {
        summaries = await this.client.getJobsOverview(budget.signal);
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

      const details = await mapLimited(selected, this.options.config.maxConcurrency, async (s): Promise<FlinkJobDetail | undefined> => {
        if (budget.signal.aborted) return undefined;
        try {
          return await this.client.getJob(s.jid, budget.signal);
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
          message:
            `Flink job details were unavailable for ${missing} job(s)` +
            `${budget.signal.aborted ? " (snapshot time budget exceeded)" : ""}; their sink tables are not shown`,
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
    } finally {
      clearTimeout(timer);
    }
  }

  // 단일 Pipeline 조회: 신선한 snapshot이 있으면 그것을, 없으면 /jobs/overview 1회 + 해당 job의 /jobs/{id} 1회만 읽는다.
  async getPipeline(id: string): Promise<PipelineLookup> {
    const match = PIPELINE_ID_PATTERN.exec(id);
    if (!match) return { pipeline: undefined, warnings: [], unavailable: false };
    const jid = match[1]!;

    const fresh = this.snapshotCache.peekFresh();
    if (fresh) {
      const unavailable = fresh.warnings.some((w) => w.code === "UPSTREAM_UNAVAILABLE");
      return { pipeline: fresh.pipelines.find((p) => p.id === id), warnings: fresh.warnings, unavailable };
    }

    let summaries: FlinkJobSummary[];
    try {
      summaries = await this.summariesCache.get(() => this.client.getJobsOverview());
    } catch (err) {
      return { pipeline: undefined, warnings: [warningFor(err)], unavailable: true };
    }
    const summary = summaries.find((s) => s.jid === jid);
    if (!summary) return { pipeline: undefined, warnings: [], unavailable: false };

    const warnings: ListWarning[] = [];
    let detail: FlinkJobDetail | undefined;
    try {
      detail = await this.detailCache.get(jid, () => this.client.getJob(jid));
    } catch {
      warnings.push({
        code: "PARTIAL",
        message: "Flink job details were unavailable; its sink tables are not shown",
        serviceId: FLINK_SERVICE_ID,
      });
    }
    const { pipelines } = buildPipelines([detail ? { summary, detail } : { summary }], {
      jobNamePrefix: this.options.config.jobNamePrefix,
      now: this.now(),
    });
    return { pipeline: pipelines[0], warnings, unavailable: false };
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
    overloaded: "Too many pending Flink JobManager requests; live pipelines are temporarily unavailable",
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
