# Beluga Manager

> Beluga Data Platform을 위한 통합 Control Plane

Beluga Manager는 Beluga Data Platform의 통합 진입점입니다. 개별 오픈소스 구성요소의 API를 통합하여 하나의 Domain Model, Control Plane, 사용자 경험을 제공합니다.

Beluga Manager는 **OSS 모음 Portal이 아닙니다.** Kafka, Flink, Iceberg, Trino, Airflow 등의 원본 시스템을 존중하면서 각 API를 연계하여 Pipeline, Data Asset, Service, Operations와 같은 Beluga 고유의 플랫폼 개념으로 통합합니다.

## 아키텍처

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

Manager는 각 OSS의 UI나 데이터를 무분별하게 복제하지 않고 authoritative API를 조합합니다.

## 핵심 Domain

- **Pipeline** — 여러 서비스에 걸친 데이터 흐름과 실행 정보
- **Data Asset** — Catalog, Table, Schema, Query 정보
- **Service** — 플랫폼 서비스, 상태, 버전, Capability
- **Operations** — 리소스, 이벤트, 로그, 상태

## 다국어

Beluga Manager는 처음부터 다국어를 지원합니다.

- `en-US` — English
- `ko-KR` — 한국어
- 브라우저 언어 자동 감지
- 사용자 언어 선택
- API는 특정 언어에 종속되지 않음
- Kafka Topic, Table, Job, Namespace 등의 실제 리소스 이름은 번역하지 않음

## 상태

🚧 초기 개발 단계

현재는 프로젝트 기반과 아키텍처를 구성하는 단계입니다. Unified Service API와 Kafka → Flink → Iceberg → Trino Pipeline을 첫 번째 Vertical Slice로 구현하면서 단계적으로 확장합니다.

## 문서

- [아키텍처](docs/architecture-ko.md)
- [개발 가이드](docs/development-ko.md)
- [기여 가이드](CONTRIBUTING-ko.md)
- [보안 정책](SECURITY-ko.md)
- [English README](README.md)

## 라이선스

Apache License 2.0. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
