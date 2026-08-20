# Beluga Manager 소개

> Beluga Data Platform을 위한 통합 Control Plane

Beluga Manager는 Beluga Data Platform의 관리 및 통합 계층입니다. Kafka, Flink, Iceberg, Trino, Airflow 등의 전문 UI를 대체하지 않고 각 upstream의 authoritative API를 연결하여 Data, Pipeline, Service, Operations에 대한 플랫폼 수준의 통합 모델을 제공합니다.

## 제품의 위치

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

핵심 가치는 개별 OSS를 설치하는 것이 아니라 **공통 identity, cross-service context, correlation, health, capability, navigation을 하나의 플랫폼 경험으로 만드는 것**입니다.

## 핵심 Domain

### Pipeline

Source, Kafka Topic, Flink Job, Iceberg Table, Trino context, Orchestration resource를 하나의 운영 흐름으로 연결합니다.

### Data Asset

Catalog, Schema, Table, Column, Partition, Storage Location, Query Context를 통합해서 제공합니다.

### Service

플랫폼 구성요소를 단순 설치 목록이 아니라 Health, Version, Dependency, Capability를 가진 Service로 표현합니다.

### Operations

Resource, Event, Health, Log, Dependency를 연결하여 플랫폼 전체 관점에서 장애를 탐색할 수 있도록 합니다.

## 아키텍처 원칙

- 각 upstream OSS가 자신의 리소스에 대한 authoritative source로 남습니다.
- Beluga API는 locale-neutral하고 안정적인 Domain API를 제공합니다.
- Frontend에는 upstream API model을 그대로 노출하지 않고 Beluga Domain Model을 제공합니다.
- 대량 metadata 복제보다 Discovery와 Correlation을 우선합니다.
- Authoritative state, Cache, Correlation Index, Beluga-owned metadata를 구분합니다.
- 불확실한 관계를 사실처럼 표현하지 않습니다.
- upstream API/version 차이는 Adapter와 Capability 계층에 격리합니다.
- Beluga가 재구현할 필요가 없는 전문 기능은 upstream UI/API를 그대로 사용할 수 있습니다.

## 다국어

MVP부터 English와 Korean을 기본 UI locale로 지원합니다. Localization은 화면 표현에만 적용하고 플랫폼 resource identity는 변경하지 않습니다.

`Kafka Topic`, `Table`, `Job`, `Namespace`, identifier 등 실제 리소스 이름은 그대로 유지합니다.

## 개발 전략

Beluga Manager는 Vertical Slice 방식으로 개발합니다. 첫 단계는 read-side 통합 경험을 검증하는 것입니다.

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

광범위한 mutation 기능보다 먼저 통합 Domain의 제품 가치를 검증합니다.

## Beluga Manager가 아닌 것

Beluga Manager는 다음을 목표로 하지 않습니다.

- OSS UI 링크를 모아놓은 Portal
- Kafka/Flink/Iceberg/Trino/Airflow의 재구현
- 전문 upstream 도구의 대체품
- upstream metadata를 모두 복제하는 별도의 metadata warehouse

## 발전 방향

실제 운영 환경에서 발견되는 cross-service 관계와 문제 해결 경험을 Beluga Domain과 테스트 자산으로 전환하면서 제품을 발전시킵니다. 중요한 Architecture Decision은 ADR로 기록하고, 통합 지식은 Domain과 CI/Regression 전략에 반영합니다.
