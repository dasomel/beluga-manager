import type { Service } from "../schema/service.js";
import { SUPPORTED_ADAPTER_CONTRACT_VERSIONS, type ServiceAdapter } from "./types.js";

export class UnsupportedAdapterVersionError extends Error {
  constructor(adapterId: string, contractVersion: number) {
    super(
      `Adapter '${adapterId}' declares contract version ${contractVersion}; ` +
        `supported versions: ${SUPPORTED_ADAPTER_CONTRACT_VERSIONS.join(", ")}`,
    );
    this.name = "UnsupportedAdapterVersionError";
  }
}

export class DuplicateAdapterError extends Error {
  constructor(adapterId: string) {
    super(`Adapter '${adapterId}' is already registered`);
    this.name = "DuplicateAdapterError";
  }
}

export class ServiceAdapterRegistry {
  private readonly adapters = new Map<string, ServiceAdapter>();

  constructor(adapters: readonly ServiceAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: ServiceAdapter): void {
    if (!SUPPORTED_ADAPTER_CONTRACT_VERSIONS.includes(adapter.contractVersion)) {
      throw new UnsupportedAdapterVersionError(adapter.id, adapter.contractVersion);
    }
    if (this.adapters.has(adapter.id)) {
      throw new DuplicateAdapterError(adapter.id);
    }
    this.adapters.set(adapter.id, adapter);
  }

  // 등록 순서를 유지한다. 한 어댑터의 실패는 해당 서비스만 unknown으로 낮추고 나머지에 영향이 없다.
  async listServices(): Promise<Service[]> {
    return Promise.all([...this.adapters.values()].map((adapter) => this.resolve(adapter)));
  }

  async getService(id: string): Promise<Service | undefined> {
    const adapter = this.adapters.get(id);
    return adapter ? this.resolve(adapter) : undefined;
  }

  private async resolve(adapter: ServiceAdapter): Promise<Service> {
    try {
      const [metadata, version, health] = await Promise.all([
        adapter.getMetadata(),
        adapter.getVersion(),
        adapter.getHealth(),
      ]);
      return { id: adapter.id, name: adapter.name, type: adapter.type, version, ...metadata, ...health };
    } catch (err) {
      // 내부 오류 세부사항은 응답에 싣지 않고 서버 로그로만 남긴다(app.onError와 동일 원칙).
      console.error(`Adapter '${adapter.id}' failed; degrading to unknown`, err);
      return {
        id: adapter.id,
        name: adapter.name,
        type: adapter.type,
        version: null,
        status: "unknown",
        endpoint: null,
        capabilities: [],
        capabilityCategories: [],
        namespace: null,
        workloadRef: null,
        keyMetrics: [],
        dependencies: [],
        lastCheckedAt: new Date().toISOString(),
        staleAfterMs: 0,
      };
    }
  }
}
