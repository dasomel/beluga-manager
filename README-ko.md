[English](README.md) | **한국어**

# Beluga Manager

> Beluga Data Platform을 위한 통합 Control Plane

Beluga Manager는 Beluga Data Platform의 통합 진입점과 관리 콘솔을 목표로 한다. 개별 오픈소스 구성요소의 API를 통합하여 하나의 Domain Model, Control Plane, 사용자 경험으로 연결하는 것이 목적이다.

Beluga Manager는 **OSS 모음 Portal이 아니다.** Kafka, Flink, Iceberg, Trino, Airflow 등 각 구성요소가 자신의 리소스에 대한 authoritative source로 남고, Manager는 각 API를 연계하여 Pipeline, Data Asset, Service, Operations와 같은 Beluga 플랫폼 개념으로 통합한다.

## 현재 상태

🚧 **Architecture/Foundation 단계 — 아직 실행 가능한 제품이 아니다.**

2026-08-28 기준으로 이 저장소에는 프로젝트 Foundation, CI, 기여/보안 정책, Architecture, Development 문서가 존재한다. 저장소 전체를 기준으로 보면 아직 실행 가능한 애플리케이션/패키지나 구현된 `/api/v1/...` 서비스 surface는 확인되지 않는다.

따라서 아래 Domain/API 설명은 **목표 계약(target contract)**이며, 현재 구현 완료된 endpoint를 의미하지 않는다.

다음 실질적인 milestone은 다음 read-first vertical slice를 로컬에서 실행하고 끝까지 검증하는 것이다.

```text
Beluga Service Discovery
        ↓
Unified Service API
        ↓
Kafka → Flink → Iceberg → Trino Correlation
        ↓
Pipeline View / API Response
```

이 경로가 구현되기 전까지 이 저장소의 first-success 기준은 제품 사용 성공이 아니라 문서/Architecture 일관성과 CI 검증이다.

## 왜 Beluga Manager인가?

Kafka, Flink, Iceberg, Trino, Airflow 같은 OSS는 각각 훌륭한 기능과 전문 UI/API를 제공한다. 실제 Data Platform 운영 비용은 **서비스 사이의 연결과 운영 맥락**에서 발생한다.

Beluga Manager는 다음 질문에 하나의 Domain으로 답하는 것을 목표로 한다.

- 어떤 Pipeline이 어떤 Kafka Topic, Flink Job, Iceberg Table과 연결되어 있는가?
- 특정 Data Asset은 어느 Catalog/Schema/Table에 있고 어떤 Query Context를 가지는가?
- 플랫폼을 구성하는 서비스가 정상인지, 어떤 Capability를 제공하는가?
- 하나의 장애가 어떤 Service/Job/Data Asset에 영향을 주는가?

즉, 개별 OSS UI를 다시 만드는 것이 아니라 **OSS API를 조합해 하나의 Data Platform 경험을 제공**하는 것이 목적이다.

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

핵심 원칙은 다음과 같다.

1. **Authoritative upstream API 사용** — 각 OSS가 자신의 리소스에 대한 source of truth로 남는다.
2. **Beluga Domain 노출** — Frontend가 OSS API 모델을 직접 소비하지 않고 안정적인 Beluga API를 사용하도록 한다.
3. **복제보다 Correlation** — 성능/탐색에 필요한 최소 Cache/Index만 유지한다.
4. **Upstream Context 보존** — 전문 기능이 필요한 경우 원래 OSS UI/API로 context를 유지한 채 이동할 수 있다.

간결한 계약은 [Architecture](docs/architecture-ko.md)를 참고한다.

## 핵심 Domain — 목표 모델

아래 Domain은 현재 설계 목표다. 관련 코드와 테스트가 `main`에 존재할 때 구현 기능으로 간주한다.

### Pipeline

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

Iceberg와 Trino의 metadata를 바탕으로 Catalog, Schema, Table, Column, Partition, Location, Query Context를 하나의 Data Asset으로 표현한다.

### Service

Kafka, Flink, Iceberg, Trino, Airflow 등을 단순 설치 목록이 아니라 Streaming, Processing, Lakehouse, Query, Orchestration 등의 Platform Capability로 표현한다.

### Operations

Resource, Event, Health, Log, Dependency를 통합하여 장애 원인과 영향을 하나의 플랫폼 맥락에서 탐색하는 것을 목표로 한다.

## 통합 모델 — 목표 경계

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

설계상 다음 상태를 구분한다.

- upstream OSS의 **authoritative state**
- 성능을 위한 **short-lived cache**
- cross-service discovery를 위한 **correlation index**
- explicit mapping 같은 **Beluga-owned metadata**

추정된 관계를 authoritative 사실처럼 표시해서는 안 된다.

## 다국어

Architecture는 초기부터 다음을 요구한다.

- `en-US` — English
- `ko-KR` — 한국어
- locale-neutral API
- 실제 Resource 이름과 identifier는 번역하지 않음

브라우저 언어 감지, 수동 선택, preference 유지, locale formatting은 구현/테스트되기 전까지 제품 요구사항으로 취급한다.

## 초기 MVP

첫 번째 Vertical Slice 목표는 다음 경로다.

```text
Kafka → Flink → Iceberg → Trino
```

### MVP 목표 범위

- Unified Service API
- Service discovery
- Cross-service correlation
- Pipeline Domain API
- Pipeline topology view
- Service health/status
- stale/degraded 상태 표현
- event/log drill-down
- English/Korean UI foundation

### 초기 제외 범위

- 전문 OSS UI 재구현
- 광범위한 mutation
- 두 번째 metadata source of truth
- 첫 Pipeline slice를 넘어선 고급 lineage
- 전체 observability platform 재구현

MVP는 **read-first**다. 파괴적인 관리 기능을 추가하기 전에 통합 경험을 먼저 증명한다.

## API 방향 — 계획된 계약

```text
GET /api/v1/services
GET /api/v1/services/{id}
GET /api/v1/pipelines
GET /api/v1/pipelines/{id}
GET /api/v1/data-assets
GET /api/v1/health
GET /api/v1/events
```

현재 이 경로들은 설계 목표이며 구현 endpoint claim이 아니다.

## 첫 성공 기준 — 다음 Milestone

구현이 시작되면 clean checkout에서 다음을 모두 증명해야 첫 runnable success로 본다.

1. 문서에 적힌 하나의 명령으로 Manager를 로컬 실행한다.
2. 실제 Beluga 환경 또는 deterministic fixture에 연결한다.
3. Unified API로 최소 하나의 실제 Service를 반환한다.
4. Kafka → Flink → Iceberg → Trino pipeline 하나를 correlation하되 추정 관계를 authoritative로 만들지 않는다.
5. 하나의 upstream dependency가 실패했을 때 health/degraded 상태를 표시한다.

이 경로가 실제 구현되고 CI 또는 integration 환경에서 검증된 뒤에만 README에 정확한 실행 명령을 추가한다.

## 문서

- [English README](README.md)
- [Architecture / 아키텍처](docs/architecture-ko.md)
- [Development Guide / 개발 가이드](docs/development-ko.md)
- [Contributing / 기여 가이드](CONTRIBUTING-ko.md)
- [Security / 보안 정책](SECURITY-ko.md)

## 기여 / 피드백

현재 단계에서 가치가 큰 기여는 API/Domain review, Correlation authority 경계 검토, upstream authority를 보존하는 구현 제안이다. 실제 upstream capability가 없는 상태에서 UI mock만으로 구현된 것처럼 보이게 만드는 변경은 피한다.

## License

Apache License 2.0. [LICENSE](LICENSE) 참조.
