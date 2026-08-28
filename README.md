English | [한국어](README-ko.md) · [About](docs/about.md)

# Beluga Manager

> **Unified Control Plane for the Beluga Data Platform**

Beluga Manager is the planned unified entry point and management console for the Beluga Data Platform. It is designed to integrate APIs from individual open-source components and turn them into a unified domain model, control plane, and user experience.

Beluga Manager is **not an OSS collection portal**. Kafka, Flink, Iceberg, Trino, Airflow, and other components remain authoritative for their own resources. Manager adds value by correlating those APIs into platform-level concepts such as **Pipelines, Data Assets, Services, and Operations**.

## Current Status

🚧 **Architecture/Foundation stage — not yet a runnable product.**

As of 2026-08-28, this repository contains the project foundation, CI, contribution/security policy, architecture, and development documentation. A repository-wide search does not yet show a runnable application/package or implemented `/api/v1/...` service surface.

That distinction is intentional: the domain/API descriptions below are the **target contract**, not evidence that those endpoints already exist.

The next meaningful milestone is a read-first vertical slice that can be started locally and proves one path end to end:

```text
Beluga service discovery
        ↓
Unified Service API
        ↓
Kafka → Flink → Iceberg → Trino correlation
        ↓
Pipeline view / API response
```

Until that exists, the first-success criterion for this repository is documentation/architecture consistency and CI validation, not product adoption.

## Why Beluga Manager?

Individual data-platform projects solve individual problems well. The operational cost appears at the boundaries between them.

Beluga Manager is designed to answer questions that cross service boundaries without forcing users to visit each OSS UI independently:

- Which Kafka Topic, Flink Job, Iceberg Table, and Trino context belong to the same Pipeline?
- Where does a Data Asset live, what schema does it have, and how can it be queried?
- Which platform services are healthy, degraded, or unavailable, and what capabilities do they provide?
- Which downstream resources are affected when a job or service fails?

The product therefore focuses on **integration and context**, not reimplementing every upstream UI.

## Architecture

```text
                        Beluga Manager
                              │
                    Unified Domain API
                              │
       ┌──────────────┬───────┼────────┬──────────────┐
       ↓              ↓       ↓        ↓              ↓
    Kafka           Flink   Iceberg   Trino         Airflow
      API             API      API      API            API
       └──────────────┴───────┴────────┴──────────────┘
                              │
                    Beluga Data Platform
```

The architecture follows four rules:

1. **Use authoritative upstream APIs.** Each OSS remains the source of truth for its resources.
2. **Expose Beluga domains, not upstream models.** Frontends should consume stable Beluga APIs rather than calling OSS APIs directly.
3. **Correlate instead of duplicate.** Beluga should store only the minimum cache/index state needed for performance and navigation.
4. **Preserve upstream context.** Specialized operations can still open the original OSS UI/API without losing the Beluga context.

See [Architecture](docs/architecture.md) for the concise architectural contract.

## Core Domains — Target Model

The domains below are design targets. They become implemented capabilities only when corresponding code/tests exist on `main`.

### Pipeline

A Pipeline represents a cross-service data flow and execution context.

```text
Source / CDC
    ↓
Kafka Topic
    ↓
Flink Job
    ↓
Iceberg Table
    ↓
Trino / Query
```

### Data Asset

A Data Asset provides a unified view of catalog and query metadata such as catalog, schema, table, columns, partitions, location, and query context.

### Service

Services are represented as platform capabilities rather than just an installation list: Streaming, Processing, Lakehouse, Query, Orchestration, BI, Storage, and Observability.

### Operations

Operations is intended to bring together resources, events, health, logs, and dependencies so a failure can be investigated from one platform context.

## Integration Model — Target Boundary

```text
OSS API
   ↓
Integration Adapter
   ↓
Discovery / Correlation
   ↓
Beluga Domain
   ↓
Unified API
   ↓
Manager UI
```

The design distinguishes between:

- **authoritative state** from the upstream OSS
- **short-lived cache** for performance
- **correlation indexes** for cross-service discovery
- **Beluga-owned metadata** such as explicit mappings

Uncertain relationships must not be presented as authoritative facts.

## Internationalization

The architecture requires internationalization from the beginning:

- `en-US` — English
- `ko-KR` — Korean
- locale-neutral APIs
- resource names/identifiers are never translated

Browser detection, language selection, preference persistence, and localized formatting remain product requirements until implemented and tested.

## Initial MVP

The first vertical slice is intentionally small:

```text
Kafka → Flink → Iceberg → Trino
```

### MVP target scope

- Unified Service API
- Service discovery
- Cross-service correlation
- Pipeline Domain API
- Pipeline topology view
- Service health/status
- degraded/stale state handling
- resource/event/log drill-down
- English/Korean UI foundation

### Initially out of scope

- Reimplementing specialized OSS UIs
- Broad mutating operations
- A second copy of the data platform metadata store
- Advanced lineage beyond the first Pipeline slice
- A full observability platform

The MVP is **read-first**: prove the unified experience before adding potentially destructive management actions.

## API Direction — Planned Contract

The planned API surface is:

```text
GET /api/v1/services
GET /api/v1/services/{id}
GET /api/v1/pipelines
GET /api/v1/pipelines/{id}
GET /api/v1/data-assets
GET /api/v1/health
GET /api/v1/events
```

These paths are design targets today, not implemented endpoint claims.

## First Verified Success — Next Milestone

When implementation begins, the first runnable success should prove all of the following from a clean checkout:

1. start the Manager locally with one documented command;
2. connect to a known Beluga environment or deterministic fixture;
3. return at least one real Service through the unified API;
4. correlate one Kafka → Flink → Iceberg → Trino pipeline without inventing authoritative relationships;
5. expose a health/degraded state when one upstream dependency is unavailable.

The README should be updated with exact commands only after this path exists and is verified in CI or an integration environment.

## Documentation

- [About](docs/about.md)
- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Korean documentation](README-ko.md)

## Contributing / Feedback

At the current stage, the highest-value contributions are API/domain review, correlation-boundary feedback, and implementation proposals that preserve upstream authority. Do not add UI-only mock behavior that implies an upstream capability exists when it does not.

## License

Apache License 2.0. See [LICENSE](LICENSE).
