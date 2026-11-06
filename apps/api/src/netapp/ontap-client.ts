export type OntapSnapshot = {
  systems: Array<{ name: string; uuid?: string; version?: string; serialNumber?: string }>;
  nodes: Array<{ name: string; uuid?: string; health?: string; eligibility?: string }>;
  aggregates: Array<{ name: string; uuid?: string; state?: string; sizeBytes?: number; usedBytes?: number }>;
  volumes: Array<{ name: string; uuid?: string; state?: string; svm?: string; sizeBytes?: number; usedBytes?: number }>;
  capacity: { sizeBytes: number; usedBytes: number; availableBytes: number; usedPercent: number | null };
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  observedAt: string;
};

type RecordData = Record<string, any>;
const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};
const nameOf = (value: unknown) => typeof value === 'string' ? value : (value as RecordData | undefined)?.name;
const nested = (value: RecordData, path: string) => path.split('.').reduce((item: any, key) => item?.[key], value);

export function normalizeOntapSnapshot(input: { cluster: RecordData[]; nodes: RecordData[]; aggregates: RecordData[]; volumes: RecordData[] }): OntapSnapshot {
  const systems = input.cluster.map((item) => ({ name: String(item.name ?? item.uuid ?? 'ONTAP cluster'), uuid: item.uuid, version: item.version?.full ?? item.version, serialNumber: item.serial_number }));
  const nodes = input.nodes.map((item) => ({ name: String(item.name ?? item.uuid ?? 'Unknown node'), uuid: item.uuid, health: typeof item.health === 'boolean' ? (item.health ? 'healthy' : 'unhealthy') : item.health, eligibility: item.eligibility }));
  const aggregates = input.aggregates.map((item) => ({ name: String(item.name ?? item.uuid ?? 'Unknown aggregate'), uuid: item.uuid, state: item.state, sizeBytes: numberValue(nested(item, 'space.block_storage.size') ?? item.size), usedBytes: numberValue(nested(item, 'space.block_storage.used') ?? item.used) }));
  const volumes = input.volumes.map((item) => ({ name: String(item.name ?? item.uuid ?? 'Unknown volume'), uuid: item.uuid, state: item.state, svm: nameOf(item.svm), sizeBytes: numberValue(nested(item, 'space.size')), usedBytes: numberValue(nested(item, 'space.used')) }));
  const sizeBytes = aggregates.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  const usedBytes = aggregates.reduce((sum, item) => sum + (item.usedBytes ?? 0), 0);
  const states = [...nodes.map((item) => item.health), ...aggregates.map((item) => item.state), ...volumes.map((item) => item.state)].filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase());
  const unhealthy = states.some((state) => ['unhealthy', 'down', 'offline', 'failed', 'error'].includes(state));
  const degraded = states.some((state) => ['degraded', 'warning', 'partial'].includes(state));
  return { systems, nodes, aggregates, volumes, capacity: { sizeBytes, usedBytes, availableBytes: Math.max(0, sizeBytes - usedBytes), usedPercent: sizeBytes > 0 ? Math.round((usedBytes / sizeBytes) * 10_000) / 100 : null }, health: unhealthy ? 'unhealthy' : degraded ? 'degraded' : states.length ? 'healthy' : 'unknown', observedAt: new Date().toISOString() };
}

export class OntapClient {
  constructor(private readonly baseUrl: string, private readonly username: string, private readonly password: string, private readonly timeoutMs = 8_000, private readonly fetcher: typeof fetch = fetch) {}

  private async getCollection(path: string) {
    const records: RecordData[] = [];
    let next: URL | undefined = new URL(`/api/${path}`, this.baseUrl);
    for (let page = 0; next && page < 20; page += 1) {
      if (next.origin !== new URL(this.baseUrl).origin || !next.pathname.startsWith('/api/')) throw new Error('ONTAP_PAGINATION_ORIGIN_INVALID');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(next, { method: 'GET', headers: { accept: 'application/hal+json', authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` }, signal: controller.signal, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) throw new Error('ONTAP_REDIRECT_BLOCKED');
        if (!response.ok) throw new Error(`ONTAP_HTTP_${response.status}`);
        const body = await response.json() as RecordData;
        if (Array.isArray(body.records)) records.push(...body.records);
        else if (path.startsWith('cluster?') && body.name) records.push(body);
        const href = body._links?.next?.href;
        next = typeof href === 'string' ? new URL(href, next) : undefined;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error('ONTAP_TIMEOUT');
        throw error;
      } finally { clearTimeout(timer); }
    }
    if (next) throw new Error('ONTAP_PAGINATION_LIMIT');
    return records;
  }

  async snapshot() {
    const fields = '?fields=name,uuid,version,serial_number';
    const [cluster, nodes, aggregates, volumes] = await Promise.all([
      this.getCollection(`cluster${fields}`),
      this.getCollection('cluster/nodes?fields=name,uuid,health,eligibility&max_records=1000'),
      this.getCollection('storage/aggregates?fields=name,uuid,state,space.block_storage.size,space.block_storage.used&max_records=1000'),
      this.getCollection('storage/volumes?fields=name,uuid,state,svm.name,space.size,space.used&max_records=1000'),
    ]);
    return normalizeOntapSnapshot({ cluster, nodes, aggregates, volumes });
  }
}
