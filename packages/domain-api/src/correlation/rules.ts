// 이슈 #35: 결정론적 rule 기반 cross-service correlation. 입력은 어댑터(#41)가 나중에
// 채울 중립적인 엔티티 목록이고, 지금은 stub 인벤토리다. 네트워크/시간/난수에 의존하지
// 않으므로 같은 입력은 항상 같은 링크를 낳는다.
//
// D1: 선언(label)이 있으면 선언만 신뢰한다 — 선언이 가리키는 대상이 없으면 링크를 만들지
//     않고(이름 추측으로 폴백하지 않음), 존재하지 않는 대상을 사실처럼 제시하지 않는다.
// D2: 이름 규약은 추정이므로 confidence 상한 0.6, 후보가 둘 이상(모호)이면 0.3. 안 맞으면
//     링크 없음(unknown) — 낮은 확신의 링크를 억지로 만들지 않는다.
import type { CorrelationEntityKind, CorrelationLink, CorrelationRelation } from "../schema/pipeline.js";

export interface CorrelationEntity {
  kind: CorrelationEntityKind;
  id: string;
  name: string;
  labels: Record<string, string>;
}

interface Rule {
  relation: CorrelationRelation;
  sourceKind: CorrelationEntityKind;
  targetKind: CorrelationEntityKind;
  // 선언 label을 가진 쪽과 그 label이 가리키는 값을 대응시킬 엔티티 이름.
  declaredOn: "source" | "target";
  labelKey: string;
  // 이름 규약 비교에 쓰는 정규화 키. 빈 문자열이면 비교 대상에서 제외한다.
  key: (entity: CorrelationEntity) => string;
}

export const DECLARED_CONFIDENCE = 0.95;
export const NAME_CONVENTION_CONFIDENCE = 0.6;
export const AMBIGUOUS_CONFIDENCE = 0.3;

const GENERIC_TOKENS = new Set(["dag", "job", "sync", "cdc", "daily", "report", "v1", "v2"]);

function tokens(name: string): string[] {
  return name.toLowerCase().split(/[-_.]/).filter((token) => token.length > 0);
}

// 첫 번째 의미 있는 토큰(예: "orders-sync" -> "orders", "orders_report_dag" -> "orders").
function firstSignificantToken(name: string): string {
  return tokens(name).find((token) => !GENERIC_TOKENS.has(token)) ?? "";
}

// "lakehouse.orders" -> "orders" (마지막 dot 세그먼트).
function lastSegmentKey(name: string): string {
  const segments = name.toLowerCase().split(".");
  return firstSignificantToken(segments[segments.length - 1] ?? "");
}

const RULES: readonly Rule[] = [
  {
    relation: "topic-feeds-job",
    sourceKind: "kafka-topic",
    targetKind: "flink-job",
    declaredOn: "target",
    labelKey: "beluga.io/source-topic",
    key: (entity) => firstSignificantToken(entity.name),
  },
  {
    relation: "job-writes-table",
    sourceKind: "flink-job",
    targetKind: "iceberg-table",
    declaredOn: "source",
    labelKey: "beluga.io/sink-table",
    // job은 첫 토큰, table은 마지막 세그먼트를 키로 쓴다.
    key: (entity) => (entity.kind === "iceberg-table" ? lastSegmentKey(entity.name) : firstSignificantToken(entity.name)),
  },
  {
    relation: "table-served-by-catalog",
    sourceKind: "iceberg-table",
    targetKind: "trino-catalog",
    declaredOn: "source",
    labelKey: "beluga.io/trino-catalog",
    // table 이름의 첫 세그먼트가 catalog 이름과 같으면 규약 일치.
    key: (entity) => (entity.kind === "iceberg-table" ? entity.name.toLowerCase().split(".")[0] ?? "" : entity.name.toLowerCase()),
  },
  {
    relation: "dag-triggers-job",
    sourceKind: "airflow-dag",
    targetKind: "flink-job",
    declaredOn: "source",
    labelKey: "beluga.io/triggers-job",
    key: (entity) => firstSignificantToken(entity.name),
  },
];

function link(rule: Rule, source: CorrelationEntity, target: CorrelationEntity, confidence: number, method: CorrelationLink["method"], evidence: string): CorrelationLink {
  return {
    id: `${rule.relation}:${source.id}->${target.id}`,
    source: { kind: source.kind, id: source.id },
    target: { kind: target.kind, id: target.id },
    relation: rule.relation,
    confidence,
    method,
    evidence: [evidence],
  };
}

export function correlate(entities: readonly CorrelationEntity[]): CorrelationLink[] {
  const links: CorrelationLink[] = [];

  for (const rule of RULES) {
    const sources = entities.filter((entity) => entity.kind === rule.sourceKind);
    const targets = entities.filter((entity) => entity.kind === rule.targetKind);
    const declaring = rule.declaredOn === "source" ? sources : targets;
    const declaredIds = new Set<string>();

    for (const owner of declaring) {
      const declared = owner.labels[rule.labelKey];
      if (declared === undefined) continue;
      declaredIds.add(owner.id);
      const other = (rule.declaredOn === "source" ? targets : sources).find((entity) => entity.name === declared);
      if (other === undefined) continue; // D1: 존재하지 않는 대상은 링크를 만들지 않는다.
      const [source, target] = rule.declaredOn === "source" ? [owner, other] : [other, owner];
      links.push(link(rule, source, target, DECLARED_CONFIDENCE, "declared-label", `label ${rule.labelKey}=${declared}`));
    }

    // 선언을 한 엔티티(D1)는 이름 규약 후보에서 제외한다.
    for (const source of sources) {
      if (rule.declaredOn === "source" && declaredIds.has(source.id)) continue;
      const sourceKey = rule.key(source);
      if (sourceKey === "") continue;
      const candidates = targets.filter((target) => !(rule.declaredOn === "target" && declaredIds.has(target.id)) && rule.key(target) === sourceKey);
      const ambiguous = candidates.length > 1;
      for (const target of candidates) {
        links.push(
          link(
            rule,
            source,
            target,
            ambiguous ? AMBIGUOUS_CONFIDENCE : NAME_CONVENTION_CONFIDENCE,
            ambiguous ? "ambiguous-name-convention" : "name-convention",
            `name key '${sourceKey}' shared by ${source.name} and ${target.name}`,
          ),
        );
      }
    }
  }

  return links.sort((a, b) => a.id.localeCompare(b.id));
}
