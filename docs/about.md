# About Beluga Manager

> Unified Control Plane for the Beluga Data Platform

Beluga Manager is the management and integration layer for Beluga Data Platform. It does not replace the specialized interfaces of Kafka, Flink, Iceberg, Trino, Airflow, or other upstream projects. Instead, it connects their authoritative APIs and presents a platform-level model for data, pipelines, services, and operations.

## Product Position

Beluga Manager sits above the individual OSS components:

```text
Upstream OSS
    ↓
Authoritative APIs
    ↓
Integration Adapters
    ↓
Discovery / Correlation
    ↓
Beluga Domain API
    ↓
Beluga Manager UI
```

The value is the integration layer: common identity, cross-service context, correlation, health, capability, and navigation.

## Core Domains

### Pipeline

Connects sources, Kafka Topics, Flink Jobs, Iceberg Tables, Trino contexts, and orchestration resources into a single operational flow.

### Data Asset

Provides a unified view of catalog, schema, table, column, partition, storage location, and query context.

### Service

Represents platform components as capabilities with health, version, dependencies, and service-level context.

### Operations

Connects resources, events, health, logs, and dependencies for platform-wide troubleshooting.

## Architectural Principles

- Keep upstream OSS authoritative for its own resources.
- Keep Beluga APIs locale-neutral and stable.
- Expose Beluga Domain Models instead of leaking upstream API models into the frontend.
- Prefer discovery and correlation over broad metadata duplication.
- Separate authoritative state, cache, correlation indexes, and Beluga-owned metadata.
- Make uncertain relationships explicit rather than presenting guesses as facts.
- Isolate upstream API/version differences behind adapters and capabilities.
- Keep specialized upstream UI access available when Beluga does not need to reimplement it.

## Internationalization

English and Korean are first-class UI locales from the MVP. Localization affects presentation, not the identity of platform resources.

`Kafka Topic`, `Table`, `Job`, `Namespace`, identifiers, and other actual resource names remain unchanged.

## Development Strategy

Beluga Manager is developed through vertical slices. The first slice intentionally focuses on read-side integration:

```text
API Contract
    ↓
Unified Service API
    ↓
Discovery / Correlation
    ↓
Kafka → Flink → Iceberg → Trino
    ↓
Data Asset / Query / Operations
```

This approach validates the product thesis before broad mutating operations are introduced.

## What Beluga Manager Is Not

Beluga Manager is not:

- a collection of links to OSS UIs
- a second implementation of Kafka/Flink/Iceberg/Trino/Airflow
- a replacement for specialized upstream tools
- a generic metadata warehouse that copies every upstream record

## Evolution

Beluga Manager will evolve by converting real operational relationships and lessons into reusable platform domains. Architecture decisions are captured in ADRs, while cross-service integration knowledge becomes part of the domain and test strategy.
