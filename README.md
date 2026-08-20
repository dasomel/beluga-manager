# Beluga Manager

> Unified Control Plane for the Beluga Data Platform

Beluga Manager is the unified entry point for the Beluga Data Platform. It integrates APIs from individual open-source components and provides a unified domain model, control plane, and user experience.

Beluga Manager is **not an OSS collection portal**. Kafka, Flink, Iceberg, Trino, Airflow, and other components remain authoritative for their own resources; Beluga Manager correlates their APIs into platform-level concepts such as Pipelines, Data Assets, Services, and Operations.

## Architecture

```text
                        Beluga Manager
                              │
                  Unified Domain / API
                              │
       ┌──────────────┬───────┼────────┬──────────────┐
       ↓              ↓       ↓        ↓              ↓
    Kafka           Flink   Iceberg   Trino         Airflow
      API             API      API      API            API
       └──────────────┴───────┴────────┴──────────────┘
                              │
                    Beluga Data Platform
```

The Manager combines authoritative APIs rather than duplicating every component's UI or data store.

## Core Domains

- **Pipeline** — cross-service data flow and execution context
- **Data Asset** — catalog, table, schema, and query context
- **Service** — platform services, health, versions, and capabilities
- **Operations** — resources, events, logs, and health

## Internationalization

Beluga Manager supports internationalization from the beginning.

- `en-US` — English
- `ko-KR` — Korean
- Browser locale detection
- Manual language selection
- Locale-neutral APIs
- Actual resource names are never translated

## Status

🚧 Early development

The repository currently contains the project foundation and architecture documentation. Implementation will proceed through small vertical slices, starting with the unified service API and a Kafka → Flink → Iceberg → Trino pipeline.

## Documentation

- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [한국어 문서](README-ko.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
