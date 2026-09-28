# ADR-0004: Hierarchical Data Asset API — Catalog → Schema → Table → Column

- **Status**: Accepted (direction) — extend the API to be hierarchical, decided by dasomel.
  The endpoint/schema/phasing design below is **not yet implemented**; `packages/web` still renders
  `DataCatalogView.tsx` from `packages/web/src/data/mockData.ts`.
- **Date**: 2026-09-24
- **Issue**: [#36 \[ROADMAP\]\[DOMAIN\] Data Asset Domain Model — Catalog + Query Integration](https://github.com/dasomel/beluga-manager/issues/36),
  [#15 \[ROADMAP\]\[UX\] Data Catalog — Iceberg Catalog / Schema / Table Explorer](https://github.com/dasomel/beluga-manager/issues/15),
  [#43 \[EXECUTION\]\[MVP\] Beluga Domain API Contract & OpenAPI Specification](https://github.com/dasomel/beluga-manager/issues/43)
- **Parent epic**: #1
- **Related**: [ADR-0001](0001-frontend-technology.md) (records the Data Catalog screen as a
  "hierarchical catalog → schema → table → column navigator"), [ADR-0002](0002-backend-api-technology.md)
  (Hono + `@hono/zod-openapi`, OPA-delegated authorization, "no second metadata store")
- **Deciders**: dasomel

## Context

`GET /api/v1/data-assets` (`packages/domain-api/src/routes/dataAssets.ts`) exists today and returns
a **flat**, paginated list of `DataAsset` rows (`packages/domain-api/src/schema/dataAsset.ts`):
`{ id, name, kind, serviceId, status }` with `kind: "table" | "topic" | "schema"`. There is no
parent/child relationship in the schema or the stub data (`packages/domain-api/src/stub-data/dataAssets.ts`).

`DataCatalogView.tsx` (`packages/web/src/views/`) is hierarchical — a left-hand catalog/schema/table
navigator driving a right-hand table-detail panel with a column schema table — and is wired to
`catalogTablesData` in `packages/web/src/data/mockData.ts`, not the real API. The code comment on the
view records why:

```
// Still on mock data: the real GET /api/v1/data-assets is a flat list, but this view is a
// hierarchical catalog -> schema -> table -> column navigator per ADR-0001 -- wiring a flat
// endpoint to a hierarchical view now would misrepresent the API, not integrate it.
```

The mock's `CatalogTable` shape (`catalog`, `schema`, `table`, `format`, `location`, `columns[]`,
`snapshotCount`) is itself a preview of the target domain model — it already carries the exact
three-level qualified name (`catalog.schema.table`) that Trino and this repository's own policy
compiler use.

**Upstream shape this must map onto**, without leaking it raw into the API (per #34, AGENTS.md
"do not expose OSS API models unchanged"):

- **Lakekeeper (Iceberg REST Catalog)**, `catalog.local.beluga.internal`, is authoritative for
  Catalog → Namespace → Table metadata. The Iceberg REST spec's namespace is an **ordered list of
  string segments**, not fixed at one level — nesting (`["analytics", "raw"]`) is part of the spec,
  even though this platform may not use it today.
- **Trino** exposes the conventional two-part `catalog.schema.table` addressing on top of that.
  This repository's existing `dataAssetKindSchema` already uses `"schema"` (not `"namespace"`) as
  the kind name, matching Trino's vocabulary — this ADR keeps that name for continuity rather than
  introducing a second synonym.
- **`beluga/policies/`** (read-only from this repository, owned by `beluga`) already declares grants
  at exactly two of these levels plus a third, finer one:
  - `catalog.yaml` → `catalogGrants: [{ catalog: iceberg, roles: [...], operations: [ShowSchemas,
    ShowTables, ...] }]` — **catalog-level** visibility.
  - `resources.yaml` → `resources: [{ resource: "lake.orders", classification, grants: [{ roles,
    privileges }], sensitiveColumns: [...] }]` — **schema.table-level** grants, with
    **column-level** `sensitiveColumns` for masking.
  - This is not incidental: it is the ABAC scoping structure the hierarchical API's node levels
    must line up with (see D7).
- **Kafka topics** are also `DataAsset`s (`kind: "topic"`) per #36, but have no natural namespace —
  they sit directly under their owning service (Kafka), not under an Iceberg-style catalog/schema
  chain.

## Decision Drivers

1. **Domain model, not OSS proxy** (#34, #29) — the hierarchy must be Beluga's own shape, not
   Iceberg's REST tree or Trino's `SHOW SCHEMAS`/`SHOW TABLES` responses re-exposed verbatim.
2. **No second metadata store** (README, AGENTS.md, ADR-0002 Decision Outcome §5) — the hierarchy is
   computed/derived and short-cache-backed against live upstreams, never a persisted tree.
3. **Lazy, bounded reads** — a catalog can have many schemas and a schema many tables; the UI's own
   navigator (left pane, click-to-expand) does not need — and must not require — the whole tree in
   one response. #43 already requires pagination on every list endpoint.
4. **Backward compatibility** — `GET /api/v1/data-assets` is implemented and covered by
   `packages/domain-api/tests/routes-data-assets.test.ts` and the OpenAPI snapshot test. There is,
   however, **no live caller today** (the frontend is still on mock data); "compatibility" here means
   *additive, reviewable schema evolution*, not a frozen wire format.
5. **ABAC alignment** (D7) — the hierarchy levels must be the same levels `beluga/policies` already
   scopes grants at (catalog, schema.table, column), so a future authorization pass has a level to
   attach to at each node instead of inventing a new one.
6. **Iceberg namespace generality** — must not hardcode two levels (`catalog.schema`) when the
   authoritative upstream (Iceberg REST) supports N-level namespace nesting.
7. **One pagination idiom** (ADR-0002 driver 1: contract cohesion) — reuse
   `packages/domain-api/src/schema/query.ts`'s existing `paginationQuerySchema` rather than inventing
   cursor pagination for this one endpoint family.

## Considered Options

### Option A — Single nested-tree response (`GET /api/v1/data-assets?tree=true`)

One call returns the whole catalog→schema→table tree as nested JSON.

**Rejected.** Unbounded fan-out defeats driver 3 and #43's pagination requirement; a single
degraded/stale node deep in the tree is awkward to surface without re-flattening the response anyway
(the existing `warnings[]` envelope assumes a flat `data[]`); expensive against live Iceberg REST
calls with no clear cache key.

### Option B — Lazy children-by-parent, reusing the existing endpoint (`?parentId=`)

`GET /api/v1/data-assets` gains an optional `parentId` query param. Omitted/`null` → top-level
catalogs; `parentId=<catalogId>` → that catalog's schemas; `parentId=<schemaId>` → that schema's
tables. One recursive shape, one schema, one pagination idiom, matches the navigator's actual
click-to-expand interaction 1:1.

**Trade-off accepted as D3/D6 below.** The *default* response (no `parentId`) necessarily changes
meaning — from "every asset, flat" to "top-level catalogs" — which is a breaking change to the one
endpoint that exists today, but with no live consumer to break. Existing tests are updated as part of
implementation (see Phase 1 test plan), not frozen.

### Option C — New, separate hierarchy endpoint, existing flat endpoint untouched

Keep `GET /api/v1/data-assets` exactly as-is (flat, e.g. for cross-cutting search/listing across all
kinds) and add a distinct resource, e.g. `GET /api/v1/catalogs`, `GET /api/v1/catalogs/{id}/schemas`,
`GET /api/v1/catalogs/{id}/schemas/{schemaId}/tables`, for the navigator.

**Rejected in favor of B.** True path-per-level REST is more RESTful in isolation, but it triples the
route/schema surface for what is one recursive relationship, and #34's architect note (ADR-0002)
already warns against per-screen endpoints (`/api/ui/...`) in favor of stable domain resources with
explicit parameters. It also creates two independently-pageable "is this a data asset" surfaces to
keep consistent as the domain grows (e.g. topics).

### Option D — Column as a `DataAsset` kind (flat list includes `kind: "column"` rows)

Enumerate columns as `DataAsset` rows alongside tables/schemas/catalogs.

**Rejected.** Columns have no independent `status`/health and no `serviceId` of their own — forcing
them into `dataAssetSchema` stretches that schema's meaning and would explode list cardinality for
wide tables. Columns are modeled as **table detail**, not as siblings in the asset list (D1).

## Decision Outcome

**Accepted: Option B** — lazy parent/child listing folded into the existing `GET /api/v1/data-assets`
endpoint via `parentId`, plus a new single-resource detail endpoint for table/column detail. Recorded
as the following decisions:

### D1 — Extend `kind`, not row cardinality; columns are detail, not rows

`dataAssetKindSchema` grows from `["table", "topic", "schema"]` to
`["catalog", "schema", "table", "topic"]` (append-only; existing values keep their meaning). Columns
are **not** a `kind` — they appear only inside a `TableDetail` payload (D3).

- **Reason**: a column has no independent health/service identity; modeling it as a `DataAsset` row
  would misuse the `status`/`serviceId` fields that exist for exactly that purpose.
- **Cost**: column-level facts (name, type, `isPartition`, `sensitive`) live in a second schema
  (`dataAssetColumnSchema`), reachable only through a table's detail, not through the list endpoint.
- **Escape hatch**: the enum is append-only by convention elsewhere in this codebase (`serviceType`,
  `healthStatus`); if a future need for independently health-tracked columns appears, add
  `kind: "column"` later without breaking existing consumers of the enum.

### D2 — Add `parentId` and `path` to `DataAsset`, both required (`parentId` nullable)

```ts
export const dataAssetKindSchema = z
  .enum(["catalog", "schema", "table", "topic"])
  .openapi("DataAssetKind");

export const dataAssetSchema = z
  .object({
    id: z.string().min(1).openapi({ example: "asset-table-orders" }),
    name: z.string().min(1).openapi({ example: "orders" }),
    kind: dataAssetKindSchema,
    serviceId: z.string().min(1).openapi({ example: "svc-iceberg" }),
    status: healthStatusSchema,
    // 최상위(catalog)는 parentId가 없다. 이 자산이 속한 부모 asset의 id — 자식 목록을
    // 조회할 때 그대로 parentId 질의 파라미터에 넣는다.
    parentId: z.string().min(1).nullable().openapi({ example: "asset-catalog-iceberg" }),
    // catalog부터 이 asset까지의 조상 segment 이름을 순서대로 담는다(자기 자신은
    // 제외). Iceberg의 다중 레벨 namespace를 그대로 표현할 수 있도록 평평한 문자열이
    // 아니라 배열로 둔다 — D8 참조.
    path: z.array(z.string().min(1)).openapi({ example: ["iceberg", "analytics"] }),
  })
  .openapi("DataAsset");
```

- **Reason**: additive fields keep the existing `DataAsset` reference type recognizable; `parentId`
  is exactly what the lazy `?parentId=` query needs; `path` lets a client render a breadcrumb or
  reconstruct a qualified name without a second round trip per ancestor.
- **Cost**: stub data / future adapters must compute `parentId`/`path` at derivation time (Iceberg's
  own listing calls already return the namespace path; this is a mapping step, not new state).
- **Escape hatch**: both fields are structurally required (not `.optional()`) so every consumer
  handles them, but `parentId: null` is the well-defined "top-level" case — no separate "root" sentinel
  value is needed.

### D3 — `?parentId=` lazy children on the existing endpoint; single-resource detail endpoint added

```
GET /api/v1/data-assets                      # parentId omitted -> top-level catalogs
GET /api/v1/data-assets?parentId=<catalogId>  # that catalog's schemas
GET /api/v1/data-assets?parentId=<schemaId>   # that schema's tables + topics
GET /api/v1/data-assets/{id}                  # single asset, kind-specific detail (D9 below)
```

`status` and pagination (`page`/`pageSize`) filters keep working unchanged, orthogonal to `parentId`
(e.g. `?parentId=<schemaId>&status=degraded&pageSize=50`), because the new query schema only adds a
field via `.extend`, mirroring how `statusFilterableListQuerySchema` itself extends
`paginationQuerySchema` in `packages/domain-api/src/schema/query.ts`:

```ts
export const dataAssetListQuerySchema = statusFilterableListQuerySchema.extend({
  // 생략/undefined -> 최상위 catalog들. 자식 목록을 조회할 부모 asset의 id를 그대로 넣는다(D4의
  // 파생 id를 그대로 재사용 — 별도 lookup 없음).
  parentId: z.string().min(1).optional(),
});
```

- **Reason**: one recursive shape for the whole tree; the navigator's click-to-expand maps directly
  onto one `parentId` call per expansion; reuses `statusFilterableListQuerySchema` and
  `buildListEnvelope`/`healthWarning` unchanged.
- **Cost**: the *default* call's meaning changes (see D6) and `packages/domain-api/tests/routes-data-assets.test.ts`'s
  fixed expectation `kinds == {table, topic, schema}` for the unfiltered call must be rewritten for
  `{catalog}` (or whatever the new stub's top level is).
- **Escape hatch**: if a genuine "give me every asset regardless of level" use case shows up later
  (e.g. global search), add `?flat=true` as an explicit, named escape rather than overloading the
  default.

### D4 — Derived, prefixed identifiers, percent-encoded per segment; no new persisted mapping

`id` stays an opaque string but follows a deterministic, kind-prefixed convention derived from the
qualified name, not a stored UUID. **Default encoding**: every variable identifier segment (catalog,
namespace segment, table name, Kafka cluster, or topic name) is percent-encoded independently — `%`
→ `%25` first, then `.` → `%2E` — before being joined with literal `.` separators. Because an encoded
segment can never itself contain a literal `.`, every `.` in the joined id is unambiguously a segment
boundary, and the encoding is reversible (split the variable portion on `.`, then percent-decode each
part). Without this, a naive dot-join contradicts D8: `path: string[]` can represent both a two-segment
namespace and a single segment that happens to contain a dot, and dot-joining them without escaping
collapses both to the same string. Encoding only namespace/table/topic segments would still leave
catalog and Kafka cluster names ambiguous.

| Kind | Convention | Example |
|---|---|---|
| catalog | `asset-catalog-<encoded catalog>` | `asset-catalog-iceberg` |
| schema | `asset-schema-<encoded catalog>.<encoded namespace segments, dot-joined>` | `asset-schema-iceberg.analytics` |
| table | `asset-table-<encoded catalog>.<encoded namespace segments, dot-joined>.<encoded table name>` | `asset-table-iceberg.analytics.orders` |
| topic | `asset-topic-<encoded Kafka cluster>.<encoded topic name>` | `asset-topic-kafka.events-raw` |

Examples that motivate the encoding:

- Nested namespace `["a", "b"]` (two segments) → `asset-schema-iceberg.a.b`.
- A single namespace segment literally named `"a.b"` → `asset-schema-iceberg.a%2Eb` — encoded, so it
  never collides with the two-segment case above even though a naive dot-join would produce `"a.b"`
  for both.
- A table named `"orders.v2"` under namespace `["analytics"]` → `asset-table-iceberg.analytics.orders%2Ev2`.
- A catalog named `"ice.berg"` → `asset-catalog-ice%2Eberg`; the same rule applies to Kafka cluster names.

- **Reason**: derivable from upstream identity with no lookup table — consistent with "no second
  metadata store" (driver 2); collision-safe across services because the prefix encodes both kind and
  owning service/catalog; per-segment percent-encoding removes the `.`-join ambiguity between a nested
  namespace and a single segment containing a literal dot that D8's `path: string[]` shape otherwise
  allows upstream to produce.
- **Cost**: id length grows with namespace depth and with encoding overhead on names containing `.`/`%`;
  must be validated against a reasonable max (e.g. 256 chars) at the adapter boundary, not left
  unbounded.
- **Escape hatch**: if derived ids ever collide or become unwieldy (very deep nesting, unusual
  characters), switch to a content hash (`sha1` of the qualified name) while keeping the
  human-readable form in `path`/`name` — an internal id representation change, invisible to API
  consumers since `id` is already documented as opaque.

### D5 — Page/pageSize pagination for children, not cursor pagination

Children listings (`?parentId=`) use the existing `paginationQuerySchema` (`page`, `pageSize` ≤ 100),
identical to every other list endpoint.

- **Reason**: one pagination idiom across the whole API (driver 7); this is an internal platform's
  catalog, not a public multi-tenant one — expected fan-out per node is modest.
- **Cost**: Iceberg REST's own namespace/table listing may itself be cursor-based
  (`page-token`); the adapter must drain or cache upstream pages before re-slicing into Beluga's
  `page`/`pageSize`, which is a real cost for very large namespaces.
- **Escape hatch**: additive — if a namespace/catalog is measured to exceed a few thousand children,
  add an opaque `pageToken` alternative to `page` later without breaking `page`/`pageSize` callers
  (mutually exclusive parameters, `page` remains the default).

### D6 — Compatibility posture: additive-schema evolution now, not endpoint versioning

`GET /api/v1/data-assets` is extended in place (D1–D3) rather than introducing `/api/v2/data-assets`
or a parallel hierarchy resource (Option C).

- **Reason**: there is no live consumer yet (frontend is on mock data); introducing a second resource
  for the same domain concept before the first one has a real caller would itself violate "not a
  second source of truth" (driver 2) and #34's not-a-proxy principle, just at the Beluga-API layer
  instead of the upstream layer.
- **Cost**: `routes-data-assets.test.ts` and the OpenAPI snapshot test change in the same PR that ships
  this; anyone who had started integrating against the current flat shape must be told explicitly
  (there is no deprecation window because there is no `/api/v2` to deprecate into). This includes
  `name`'s meaning changing from fully-qualified to leaf-only (see Consequences) — a behavior change,
  not just an additive one, accepted here for the same reason (no live consumer).
- **Escape hatch**: if a real external consumer appears before this ships, version at that point
  (`/api/v2/data-assets`) per the API-versioning principle ADR-0002 already lists as owed.

### D7 — ABAC/policy scoping mirrors `beluga/policies`' existing three levels

The hierarchy's node levels are chosen to line up 1:1 with where `beluga/policies` already declares
grants, so a future authorization pass has an existing level to attach to instead of inventing one:

- **catalog** node ↔ `catalog.yaml`'s `catalogGrants` (per-catalog Trino operations like
  `ShowSchemas`/`ShowTables`) — a caller with no grant on a catalog should not see that catalog node
  (or anything under it) at all.
- **schema**/**table** nodes ↔ `resources.yaml`'s `resource: "<namespace>.<table>"` grants
  (`classification`, `privileges`) — visibility requires at least `select`.
- **column** (inside table detail) ↔ `resources.yaml`'s `sensitiveColumns` — surfaced as a `sensitive:
  boolean` flag per column (D9), never as unmasked data; actual query execution and masking remain
  Trino/OPA's job (Query Workspace), the Domain API only reflects classification for display.
- **Reason**: keeps one authorization source (OPA, per ADR-0002 Decision Outcome §3) instead of a
  second grant engine re-implemented in the Domain API.
- **Cost**: hierarchy listing needs an authorization check per catalog/schema/table node — a new
  integration surface (querying OPA, likely batched per page rather than per node) not yet built.
- **Escape hatch, and a hard gate, not a nice-to-have**: until that OPA integration lands, an interim
  build **must** either (a) not ship to any real user, or (b) mark every hierarchy response as
  unauthorized/unfiltered via an explicit `warnings[]` entry (reusing the existing envelope), per
  AGENTS.md's "uncertain/inferred relationships must not be presented as facts" — silently returning
  an unfiltered tree would misrepresent access control as enforced when it is not. This is one of the
  open questions below, not a decision this ADR can make unilaterally (D7 records the *shape*; the
  *go/no-go gate* is Open Question 3). The same gate covers `childCount` (D9): a count is itself
  existence/cardinality information about children the caller may not be authorized to see, so until
  node-level OPA filtering exists, `childCount` must be `null`, never a raw unfiltered number.

### D8 — `path` is an ordered array of segments, not a dotted string

Internally and on the wire, namespace/catalog ancestry is `path: string[]`, with a separately
computed, display-only `qualifiedName` (dot-joined) wherever the UI needs a single string (e.g. the
sample-SQL template `${catalog}.${schema}.${table}` the view already builds).

- **Reason**: Iceberg REST's namespace is natively a segment list and supports N-level nesting; a
  dotted string would either forbid dots inside a segment name or require escaping, and would need a
  breaking change the day nesting deeper than one level is actually used.
- **Cost**: minor modeling overhead today, since this platform's `beluga/policies` resources
  (`lake.orders`) are currently only ever one namespace segment deep.
- **Escape hatch**: none needed — an array of length 1 costs nothing extra and is exactly today's
  shape; the generality is free until it's used.

### D9 — Single-resource detail endpoint, kind-discriminated

```ts
export const dataAssetColumnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    isPartition: z.boolean().optional(),
    comment: z.string().optional(),
    // resources.yaml의 sensitiveColumns로부터 파생 — 실제 마스킹은 Trino/OPA가 수행하고
    // 여기서는 표시용 분류만 반영한다(D7).
    sensitive: z.boolean(),
  })
  .openapi("DataAssetColumn");

export const dataAssetDetailSchema = z.discriminatedUnion("kind", [
  dataAssetSchema.extend({
    kind: z.literal("catalog"),
    // beluga/policies grant로 필터링된 이후의 인가된 자식 수(D7). node-level OPA 필터링이
    // 아직 없는 interim 기간에는 D7의 escape hatch에 따라 항상 null이다 — 필터링되지
    // 않은 원본 카운트를 노출하면 access control이 실제로는 강제되지 않은 것을 강제된
    // 것처럼 왜곡한다.
    childCount: z.number().int().nonnegative().nullable(),
  }),
  dataAssetSchema.extend({
    kind: z.literal("schema"),
    // catalog와 동일한 규칙 — 위 주석 참조.
    childCount: z.number().int().nonnegative().nullable(),
  }),
  dataAssetSchema.extend({
    kind: z.literal("table"),
    format: z.string().min(1).openapi({ example: "ICEBERG_V2" }),
    location: z.string().min(1).openapi({ example: "s3://beluga-lake/analytics/orders" }),
    snapshotCount: z.number().int().nonnegative(),
    columns: z.array(dataAssetColumnSchema),
  }),
  dataAssetSchema.extend({
    kind: z.literal("topic"),
    partitionCount: z.number().int().nonnegative(),
    replicationFactor: z.number().int().positive(),
  }),
]).openapi("DataAssetDetail");
```

`GET /api/v1/data-assets/{id}` returns `dataAssetDetailSchema` (404 via the existing
`errorResponseSchema` for an unknown id). This is what the right-hand detail panel in
`DataCatalogView.tsx` (columns table, format badge, location, snapshot count) is built from.

- **Reason**: table/topic detail (columns, format, location, snapshots) does not belong in the list
  envelope (driver 3: bounded reads) and is naturally single-resource REST; a discriminated union lets
  each kind carry only the fields that make sense for it instead of an all-optional grab-bag.
- **Cost**: one more route/schema pair; `@hono/zod-openapi` must render a discriminated union cleanly
  in the OpenAPI document (verify in Phase 1 against the existing `openapi-document.test.ts` pattern).
  `childCount` on the `catalog`/`schema` members is authorization-sensitive (D7): it must be computed
  from the same authorized child set a subsequent `?parentId=` call would return, never from an
  unfiltered upstream count, or it leaks the existence/cardinality of children the caller cannot see.
  Until OPA node filtering exists (D7's interim gate), `childCount` is `null` rather than a real number.
- **Escape hatch**: if the union becomes unwieldy, fall back to one shared shape with kind-specific
  fields all `.optional()` — strictly worse typing, kept only as a documented fallback.

## Screen mapping (`DataCatalogView.tsx`)

| UI element | Call |
|---|---|
| Left navigator, initial paint | `GET /api/v1/data-assets` (top-level catalogs) |
| Expand a catalog node | `GET /api/v1/data-assets?parentId=<catalogId>` (its schemas) |
| Expand a schema node | `GET /api/v1/data-assets?parentId=<schemaId>` (its tables/topics) |
| Select a table (right-hand detail panel: format badge, location, snapshot count, columns table) | `GET /api/v1/data-assets/{tableId}` |
| Sample-SQL template (`${catalog}.${schema}.${table}`) | built client-side from the selected table's `path` + `name` — no new endpoint |
| Stale/degraded status badge on any node | `status` field already on `DataAsset`, unchanged |

## Phased implementation plan and test plan

**Phase 1 — Schema and stub data only (no live upstream yet), mirrors today's stub-data pattern.**

- Extend `dataAssetKindSchema`, `dataAssetSchema` (D1, D2), add `dataAssetColumnSchema` and
  `dataAssetDetailSchema` (D9) in `packages/domain-api/src/schema/dataAsset.ts`.
- Rewrite `packages/domain-api/src/stub-data/dataAssets.ts` as a small hand-authored
  catalog→schema→table(+topic) tree with consistent derived ids (D4) and `parentId`/`path` (D2), kept
  small and explicit like the current 4-row stub.
- Extend `registerDataAssetRoutes` (`packages/domain-api/src/routes/dataAssets.ts`) with `parentId`
  filtering and add the `GET /api/v1/data-assets/{id}` route.
- **Tests**: rewrite `routes-data-assets.test.ts`'s "all kinds present" assertion for the new
  top-level default; add cases for `?parentId=` at each level (catalog→schema, schema→table),
  `?parentId=` for an unknown id (empty list, not 404 — a parent existing is not guaranteed by this
  endpoint's contract), `GET /api/v1/data-assets/{id}` for each kind (200 with the right union member)
  and for an unknown id (404 `ErrorResponse`). Extend `openapi-document.test.ts` to cover the new
  route/schemas/discriminated union rendering. Add id-derivation unit tests for D4's percent-encoding:
  round-trip (encode then decode a name containing `.` and one containing `%` recovers the original),
  and the collision case (nested namespace `["a", "b"]` vs a single segment literally named `"a.b"`
  must derive to different ids). Add a `childCount` test asserting the Phase 1 stub returns `null`
  (D7/D9's interim, pre-OPA-filtering posture), not an unfiltered number.

**Phase 2 — Frontend integration.**

- Replace `catalogTablesData` in `DataCatalogView.tsx` with the four calls in the screen-mapping
  table above (likely via TanStack Query, per ADR-0001), remove the mock-data code comment, keep
  `mockData.ts`'s `CatalogTable` type only if still used elsewhere (grep before deleting).
- **Tests**: component/integration tests for expand/collapse driving the right `parentId` calls, and
  for the detail panel rendering each of the four `dataAssetDetailSchema` union members.

**Phase 3 — Live Iceberg/Trino adapter** (depends on #41/#42's adapter work landing first;
out of scope for this ADR beyond the id/path derivation contract D2/D4 the adapter must satisfy).

- Adapter maps Lakekeeper REST catalog/namespace/table listings and Trino catalog metadata into the
  Phase 1 schema; Kafka topics map in under their owning service with no schema level.
- **Tests**: adapter-level tests against a recorded/fixture Iceberg REST response (contract test, not
  a live-cluster test) verifying `parentId`/`path`/derived `id` computation matches D2/D4/D8 exactly.

**Phase 4 — Authorization enforcement (D7)**, gated by Open Question 3 below; blocks any hierarchy
rollout to a real (non-developer) user until resolved.

## Consequences

- `dataAssetKindSchema`, `dataAssetSchema`, and the OpenAPI document for `/api/v1/data-assets` all
  change; `routes-data-assets.test.ts` and `openapi-document.test.ts` are updated in the same change,
  not preserved as frozen golden files (D6).
- A new `DataAssetColumn`/`DataAssetDetail` schema pair and a new `GET /api/v1/data-assets/{id}` route
  are added.
- `DataCatalogView.tsx`'s mock-data comment is updated to point at this ADR (done alongside this ADR;
  see the one-line diff in the same commit) — the code itself stays on mock data until Phase 2 ships.
- `dataAssetSchema.name`'s semantics change from fully-qualified (today's implementation, e.g.
  `analytics.orders` per `packages/domain-api/src/schema/dataAsset.ts:9`) to leaf-only (this ADR's D2
  example, `orders`; the qualified form is reconstructed from `path` + `name`, D8). This is a behavior
  change to an existing field, not merely an additive one — low real risk per D6 (no live consumer to
  break); the escape hatch is D6's: if a real consumer of the current fully-qualified `name` appears
  before this ships, version (`/api/v2`) instead of changing the field's meaning in place.
- No new persisted store; the hierarchy remains fully derived, consistent with the standing "no second
  metadata store" principle.
- Authorization enforcement for hierarchy nodes (D7) is explicitly **not** solved by this ADR — it is
  a hard gate on real-user rollout (Open Question 3), not an implementation detail to fill in silently
  during Phase 1–3.

## Open Questions for dasomel

1. **Sequencing against #41/#42**: should Phase 1 (schema + stub data) ship on its own now, ahead of
   the real Iceberg/Trino adapter work, the way today's flat stub already does? This ADR assumes yes
   (mirrors the existing pattern) but that is a scheduling call, not something derivable from the repo.
2. **Kafka topics in this tree at all?** #36 lists `topic` as a `DataAsset` kind, but #15 frames the
   Data Catalog screen specifically as an "Iceberg Catalog / Schema / Table Explorer." Should topics
   appear as leaves under a synthetic top-level Kafka node in this same screen/endpoint, or be excluded
   from the Data Catalog screen entirely and left to a different view (e.g. a future Kafka/topics
   view)? This ADR's schema supports either answer (D1 keeps `topic` in the enum either way); the
   screen-mapping table above assumes topics *are* shown, which needs confirmation.
3. **Authorization go/no-go gate (D7)**: is it acceptable to ship Phases 1–3 to real users with
   hierarchy nodes **unfiltered** (every catalog/schema/table visible regardless of `beluga/policies`
   grants) as long as responses are marked with an explicit unauthorized/unfiltered warning, or must
   OPA-backed node filtering land before any real-user rollout? The same answer governs `childCount`
   (D9): whether it may ever be a real, unfiltered number before Phase 4, or must stay `null` until
   node-level OPA filtering lands. This is a security/product decision, not something this ADR can
   default.
4. **Expected fan-out**: D5 assumes page/pageSize pagination is adequate because per-node fan-out
   (schemas per catalog, tables per schema) is expected to stay in the tens/low-hundreds on this
   platform. Is that assumption correct for the catalogs actually planned, or should cursor pagination
   be designed in from Phase 1 instead of deferred to D5's escape hatch?
5. **ID stability across renames**: D4's derived ids change if a catalog/schema/table is renamed
   upstream (the id is a function of the qualified name). Is that acceptable (consistent with "no
   second metadata store" — nothing to migrate), or does something depending on a stable id across
   renames (e.g. saved views, deep links, audit references) need a different identity scheme?
