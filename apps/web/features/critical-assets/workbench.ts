export type Group = { id: string; name: string };
export type Outcome = 'CONFIRMED' | 'CORRECTION_NEEDED';
export type DueState = 'overdue' | 'due_this_week' | 'up_to_date' | 'unscheduled';
export type Attestation = {
  id: string;
  weekStart: string;
  outcome?: string | null;
  notes?: string | null;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  confirmedByName?: string | null;
};
export type ApiAsset = {
  id: string;
  name: string;
  type: string;
  hostname?: string | null;
  managementIp?: string | null;
  serialNumber?: string | null;
  assetTag?: string | null;
  status: string;
  owner?: Group | null;
  assignedGroup?: Group | null;
  dueState?: DueState;
  dueDate?: string | null;
  dueWeekStart?: string | null;
  pendingCount?: number;
  overdueCount?: number;
  latestOutcome?: string | null;
  latestConfirmedAt?: string | null;
  attestations: Attestation[];
};
export type Mapping = { id: string; assetType: string; group: Group };
export type CriticalAssetsResult = { timezone: string; generatedAt?: string; assets: ApiAsset[]; unassigned: ApiAsset[]; mappings: Mapping[] };

/** One table row: the API asset with every derived field filled in, so older payloads still render. */
export type AssetRow = ApiAsset & {
  owner: Group | null;
  dueState: DueState;
  dueDate: string | null;
  pendingCount: number;
  latestOutcome: string | null;
  latestConfirmedAt: string | null;
  latestReviewer: string | null;
  /** Pending cycles, oldest first: the ones a reviewer can still record. */
  pending: Attestation[];
};

export type Filters = { type: string; owner: string; outcome: string; due: string };
export const emptyFilters: Filters = { type: '', owner: '', outcome: '', due: '' };
export const NO_OWNER = '__none__';
export const NO_OUTCOME = '__none__';
export const assetTypes = ['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER'];

export const dueLabels: Record<DueState, string> = { overdue: 'Em atraso', due_this_week: 'Para esta semana', up_to_date: 'Em dia', unscheduled: 'Sem agendamento' };
/** Existing state-badge tones: red, amber, green, neutral. */
export const dueTone: Record<DueState, string> = { overdue: 'excluded', due_this_week: 'reserved', up_to_date: 'occupied', unscheduled: '' };
export const outcomeLabel = (outcome?: string | null) => (outcome === 'CONFIRMED' ? 'Confirmado' : outcome === 'CORRECTION_NEEDED' ? 'Correção pedida' : 'Pendente');
export const outcomeTone = (outcome?: string | null) => (outcome === 'CONFIRMED' ? 'occupied' : outcome === 'CORRECTION_NEEDED' ? 'excluded' : 'pending');
export const dueOrder: Record<DueState, number> = { overdue: 0, due_this_week: 1, unscheduled: 2, up_to_date: 3 };

/** Admins get every asset in `assets` and the unowned ones again in `unassigned`: merge once by id. */
export function buildRows(data: CriticalAssetsResult | undefined): AssetRow[] {
  if (!data) return [];
  const byId = new Map<string, ApiAsset>();
  for (const asset of [...data.assets, ...data.unassigned]) if (!byId.has(asset.id)) byId.set(asset.id, asset);
  return [...byId.values()].map((asset) => {
    const owner = asset.owner !== undefined ? asset.owner : asset.assignedGroup ?? data.mappings.find((mapping) => mapping.assetType === asset.type)?.group ?? null;
    const history = [...asset.attestations].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    const latest = history.find((row) => row.outcome) ?? null;
    const pending = history.filter((row) => !row.outcome).reverse();
    return {
      ...asset,
      attestations: history,
      owner,
      // Without an owner nobody is due: the API reports 'unscheduled' and keeps the pending counts.
      dueState: asset.dueState ?? (!owner ? 'unscheduled' : pending.length ? 'due_this_week' : history.length ? 'up_to_date' : 'unscheduled'),
      dueDate: asset.dueDate ?? null,
      pendingCount: asset.pendingCount ?? pending.length,
      latestOutcome: asset.latestOutcome !== undefined ? asset.latestOutcome : latest?.outcome ?? null,
      latestConfirmedAt: asset.latestConfirmedAt !== undefined ? asset.latestConfirmedAt : latest?.confirmedAt ?? null,
      latestReviewer: latest?.confirmedByName ?? null,
      pending,
    };
  }).sort((a, b) => dueOrder[a.dueState] - dueOrder[b.dueState] || a.name.localeCompare(b.name));
}

export function countRows(rows: AssetRow[]) {
  return {
    overdue: rows.filter((row) => row.dueState === 'overdue').length,
    dueThisWeek: rows.filter((row) => row.dueState === 'due_this_week').length,
    needsCorrection: rows.filter((row) => row.latestOutcome === 'CORRECTION_NEEDED').length,
    noOwner: rows.filter((row) => !row.owner).length,
  };
}

export function filterRows(rows: AssetRow[], search: string, filters: Filters): AssetRow[] {
  const term = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.type && row.type !== filters.type) return false;
    if (filters.owner === NO_OWNER ? row.owner : filters.owner && row.owner?.id !== filters.owner) return false;
    if (filters.outcome === NO_OUTCOME ? row.latestOutcome : filters.outcome && row.latestOutcome !== filters.outcome) return false;
    if (filters.due && row.dueState !== filters.due) return false;
    if (!term) return true;
    return [row.name, row.type, row.hostname, row.managementIp, row.serialNumber, row.assetTag, row.owner?.name].some((value) => value?.toLowerCase().includes(term));
  });
}

/** Bulk confirm records only the current cycle (newest pending week); older weeks need an individual review. */
export const currentCycle = (row: AssetRow): Attestation | undefined => row.pending.at(-1);
export const hasOlderPending = (row: AssetRow) => row.pending.length > 1;

export const hasActiveFilters = (search: string, filters: Filters) => Boolean(search.trim()) || Object.values(filters).some(Boolean);

/** Replaces one attestation in every cached site payload after a successful review. */
export function withRecordedAttestation(current: CriticalAssetsResult | undefined, saved: Attestation): CriticalAssetsResult | undefined {
  if (!current) return current;
  const update = (asset: ApiAsset): ApiAsset => {
    if (!asset.attestations.some((item) => item.id === saved.id)) return asset;
    const attestations = asset.attestations.map((item) => (item.id === saved.id ? { ...item, ...saved } : item));
    const pending = attestations.filter((item) => !item.outcome);
    return {
      ...asset,
      attestations,
      latestOutcome: saved.outcome ?? asset.latestOutcome,
      latestConfirmedAt: saved.confirmedAt ?? asset.latestConfirmedAt,
      pendingCount: pending.length,
      overdueCount: Math.min(asset.overdueCount ?? 0, pending.length),
      // The server recomputes the exact due date on the next fetch; locally a fully reviewed asset is up to date.
      ...(asset.dueState && asset.dueState !== 'unscheduled' && !pending.length ? { dueState: 'up_to_date' as DueState } : {}),
    };
  };
  return { ...current, assets: current.assets.map(update), unassigned: current.unassigned.map(update) };
}
