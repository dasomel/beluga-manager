import { expect, test } from "vitest";
import {
  AMBIGUOUS_CONFIDENCE,
  correlate,
  DECLARED_CONFIDENCE,
  NAME_CONVENTION_CONFIDENCE,
  type CorrelationEntity,
} from "../src/correlation/rules.js";
import { correlationLinkSchema } from "../src/schema/pipeline.js";

const topic = (name: string): CorrelationEntity => ({ kind: "kafka-topic", id: `topic-${name}`, name, labels: {} });
const job = (name: string, labels: Record<string, string> = {}): CorrelationEntity => ({ kind: "flink-job", id: `job-${name}`, name, labels });
const table = (name: string, labels: Record<string, string> = {}): CorrelationEntity => ({ kind: "iceberg-table", id: `table-${name}`, name, labels });
const catalog = (name: string): CorrelationEntity => ({ kind: "trino-catalog", id: `catalog-${name}`, name, labels: {} });
const dag = (name: string, labels: Record<string, string> = {}): CorrelationEntity => ({ kind: "airflow-dag", id: `dag-${name}`, name, labels });

test("선언 label은 topic -> Flink job 링크를 높은 확신도로 만든다", () => {
  const links = correlate([topic("orders.cdc"), job("anything", { "beluga.io/source-topic": "orders.cdc" })]);
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ relation: "topic-feeds-job", method: "declared-label", confidence: DECLARED_CONFIDENCE });
  expect(links[0]?.evidence).toEqual(["label beluga.io/source-topic=orders.cdc"]);
});

test("선언이 존재하지 않는 대상을 가리키면 이름이 맞아도 링크를 만들지 않는다", () => {
  const links = correlate([topic("orders.cdc"), job("orders-sync", { "beluga.io/source-topic": "ghost.topic" })]);
  expect(links).toEqual([]);
});

test("이름 규약만으로 맞으면 낮은 확신도의 name-convention 링크", () => {
  const links = correlate([topic("orders.cdc"), job("orders-sync")]);
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ method: "name-convention", confidence: NAME_CONVENTION_CONFIDENCE });
  expect(links[0]?.confidence).toBeLessThan(DECLARED_CONFIDENCE);
});

test("후보가 둘 이상이면 모호하므로 더 낮은 확신도로 모두 표시한다", () => {
  const links = correlate([dag("orders_report_dag"), job("orders-sync"), job("orders-backfill")]);
  expect(links).toHaveLength(2);
  for (const l of links) {
    expect(l).toMatchObject({ relation: "dag-triggers-job", method: "ambiguous-name-convention", confidence: AMBIGUOUS_CONFIDENCE });
  }
});

test("매칭되는 키가 없으면(unknown) 링크를 만들지 않는다", () => {
  expect(correlate([topic("audit.events"), job("orders-sync"), table("staging.clicks"), catalog("lakehouse"), dag("billing_dag")])).toEqual([]);
  expect(correlate([])).toEqual([]);
});

test("job -> Iceberg table, table -> Trino catalog 쌍을 선언과 이름 규약으로 만든다", () => {
  const declared = correlate([job("x", { "beluga.io/sink-table": "lakehouse.orders" }), table("lakehouse.orders")]);
  expect(declared).toHaveLength(1);
  expect(declared[0]).toMatchObject({ relation: "job-writes-table", method: "declared-label" });

  const byName = correlate([table("lakehouse.orders"), catalog("lakehouse"), catalog("other")]);
  expect(byName).toHaveLength(1);
  expect(byName[0]).toMatchObject({ relation: "table-served-by-catalog", method: "name-convention", target: { kind: "trino-catalog", id: "catalog-lakehouse" } });

  const viaLabel = correlate([table("t", { "beluga.io/trino-catalog": "lakehouse" }), catalog("lakehouse")]);
  expect(viaLabel[0]).toMatchObject({ relation: "table-served-by-catalog", method: "declared-label" });
});

test("결정론적이며 모든 링크는 스키마를 만족한다", () => {
  const input = [topic("orders.cdc"), job("orders-sync"), table("lakehouse.orders"), catalog("lakehouse"), dag("orders_report_dag")];
  const a = correlate(input);
  const b = correlate([...input].reverse());
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThanOrEqual(4);
  for (const l of a) expect(() => correlationLinkSchema.parse(l)).not.toThrow();
});
