// 런타임 설정 로더. Domain API의 모든 upstream 연동은 기본 비활성이다(D1): 환경 변수가 없으면
// stub fixture 동작이 그대로 유지되므로 CI와 로컬 개발은 외부 시스템 없이 돌아간다.
// 잘못된 값은 요청 시점이 아니라 기동 시점에 즉시 실패한다(fail-fast).

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface FlinkAdapterConfig {
  /** Flink JobManager REST base URL (scheme://host[:port], 경로/자격증명 없음). */
  baseUrl: string;
  timeoutMs: number;
  /** correlation 이름 규약 비교 전에 job 이름에서 제거하는 접두어. 빈 문자열이면 제거 안 함. */
  jobNamePrefix: string;
}

// D2: 2s는 ServiceAdapterRegistry의 기본 3s deadline보다 짧아, 어댑터가 자체 timeout으로 먼저
// 분류된 실패를 낸다. 상한 30s는 요청 핸들러가 무기한 매달리지 않게 하는 안전 한계다.
export const DEFAULT_FLINK_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_FLINK_JOB_NAME_PREFIX = "beluga-";

export function loadFlinkAdapterConfig(env: Record<string, string | undefined>): FlinkAdapterConfig | undefined {
  const raw = env["BELUGA_FLINK_REST_URL"]?.trim();
  if (raw === undefined || raw === "") return undefined; // 비활성(기본)

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("BELUGA_FLINK_REST_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("BELUGA_FLINK_REST_URL must use http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConfigError("BELUGA_FLINK_REST_URL must not embed credentials");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") {
    throw new ConfigError("BELUGA_FLINK_REST_URL must be a bare origin (no path, query or fragment)");
  }

  const timeoutRaw = env["BELUGA_FLINK_TIMEOUT_MS"]?.trim();
  let timeoutMs = DEFAULT_FLINK_TIMEOUT_MS;
  if (timeoutRaw !== undefined && timeoutRaw !== "") {
    timeoutMs = Number(timeoutRaw);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new ConfigError(`BELUGA_FLINK_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
    }
  }

  return {
    baseUrl: url.origin,
    timeoutMs,
    jobNamePrefix: env["BELUGA_FLINK_JOB_NAME_PREFIX"] ?? DEFAULT_FLINK_JOB_NAME_PREFIX,
  };
}
