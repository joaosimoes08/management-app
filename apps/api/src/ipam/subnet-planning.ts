/**
 * IPv4 subnet planning: a read-only preview of how to carve aligned child
 * blocks (e.g. /27 LANs or /30 and /31 point-to-point links) out of a parent
 * subnet without touching anything that is already allocated inside it.
 *
 * Everything here is pure: the service loads the rows and this module does
 * the arithmetic, so every rule is covered by unit tests without a database.
 *
 * Addresses are handled as plain numbers (0..2^32-1). They stay well inside
 * Number.MAX_SAFE_INTEGER, so no bitwise operators are used on block sizes
 * (a /0 block is 2^32, which a 32-bit shift cannot express).
 */

export const IPV4_SPACE = 2 ** 32;
/** The most planned blocks one preview returns; a /32 split of a /16 would otherwise be 65 536 rows. */
export const MAX_PLANNED_BLOCKS = 1024;
/** The most rows the parent map returns; scattered hosts in a /16 could otherwise produce tens of thousands. */
export const MAX_MAP_SEGMENTS = 2000;

export type PlanningAllocationKind = 'SUBNET' | 'HOST' | 'RESERVED' | 'GATEWAY';

/** Something that already occupies addresses inside the parent. */
export type PlanningAllocation = { kind: PlanningAllocationKind; start: number; end: number; label?: string | null; subnetId?: string | null };

export type PlanningAddressRow = { address: string; state: string; deviceId?: string | null; interfaceId?: string | null; hostId?: string | null };
export type PlanningSubnetRow = { id?: string | null; cidr: string; purpose?: string | null; hidden?: boolean };

export type PlanningRequest = { prefix: number; count?: number | null };

export type PlannedBlock = { cidr: string; prefix: number; start: string; end: string; size: number; usable: number };
export type PlanningMapSegment = {
  /**
   * RESERVED: the parent's own network or broadcast address (parents up to /30), counted as unavailable like Utilização does.
   * CONFLICT: an aligned candidate block of the requested size that the plan skipped; `conflicts` says why and
   * `breakdown` splits its addresses so the map's free total still matches `addressSpace.freeAfterPlan`.
   */
  status: 'FREE' | 'TAKEN' | 'PLANNED' | 'RESERVED' | 'CONFLICT';
  start: string;
  end: string;
  count: number;
  /** FREE: the free range split into the largest aligned CIDRs. TAKEN/PLANNED: the CIDR when the range is exactly one block. */
  cidrs: string[];
  /** TAKEN rows only: what occupies the range. */
  kinds?: PlanningAllocationKind[];
  label?: string | null;
  subnetId?: string | null;
  conflicts?: PlanningConflict[];
  breakdown?: { taken: number; reserved: number; free: number };
};
/**
 * An aligned candidate the plan passed over, with the reason. `insideExisting` means the candidate lies inside an
 * existing subnet (then `cidr` is that subnet and `blocks` how many candidates it holds), so the map keeps the
 * subnet's own row instead of drawing a conflict row.
 */
export type SkippedBlock = { cidr: string; prefix: number; start: string; end: string; size: number; blocks: number; insideExisting: boolean; conflicts: PlanningConflict[] };
/** The most skipped rows one preview returns. */
export const MAX_SKIPPED_BLOCKS = 256;
export type PlanningShortfall = { prefix: number; requested: number | null; planned: number; missing: number | null; reason: 'PREFIX_SHORTER_THAN_PARENT' | 'NO_FREE_ALIGNED_BLOCK' | 'NOT_ENOUGH_FREE_SPACE' | 'TRUNCATED' };

// ---------------------------------------------------------------- primitives

export function parseIpv4(address: string): number | null {
  const parts = address.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIpv4(value: number) {
  return [Math.floor(value / 16777216) % 256, Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256].join('.');
}

export function blockSize(prefix: number) { return 2 ** (32 - prefix); }

/** Parses "a.b.c.d/p" into its aligned network and last address. Host bits are cleared, like the rest of the IPAM module. */
export function parseIpv4Cidr(cidr: string): { network: number; broadcast: number; prefix: number } | null {
  const [address, prefixText, extra] = cidr.trim().split('/');
  if (extra !== undefined || prefixText === undefined || !/^\d{1,2}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  const value = parseIpv4(address);
  if (value === null || prefix > 32) return null;
  const size = blockSize(prefix);
  const network = Math.floor(value / size) * size;
  return { network, broadcast: network + size - 1, prefix };
}

export function usableInBlock(prefix: number) { return prefix >= 31 ? blockSize(prefix) : blockSize(prefix) - 2; }

/** Splits an inclusive range into the fewest aligned CIDR blocks (the standard range-to-prefix walk). */
export function rangeToCidrs(start: number, end: number): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    let prefix = 32;
    // Grow the block while it stays aligned on `cursor` and inside the range.
    while (prefix > 0) {
      const bigger = blockSize(prefix - 1);
      if (cursor % bigger !== 0 || cursor + bigger - 1 > end) break;
      prefix--;
    }
    out.push(`${formatIpv4(cursor)}/${prefix}`);
    cursor += blockSize(prefix);
  }
  return out;
}

type Interval = { start: number; end: number };

function mergeIntervals(items: Interval[]): Interval[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end + 1) last.end = Math.max(last.end, item.end);
    else out.push({ ...item });
  }
  return out;
}

/** The parts of [start, end] not covered by `taken` (which must be merged and sorted). */
function complement(start: number, end: number, taken: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = start;
  for (const item of taken) {
    if (item.end < cursor) continue;
    if (item.start > end) break;
    if (item.start > cursor) out.push({ start: cursor, end: Math.min(item.start - 1, end) });
    cursor = Math.max(cursor, item.end + 1);
    if (cursor > end) break;
  }
  if (cursor <= end) out.push({ start: cursor, end });
  return out;
}

/**
 * Lowest-address-first placement of aligned blocks of `prefix` inside the free
 * intervals. A block starts on a multiple of its size and lies wholly inside
 * one free interval, so it can never overlap anything taken.
 */
function placeAligned(free: Interval[], prefix: number, limit: number): number[] {
  const size = blockSize(prefix);
  const starts: number[] = [];
  for (const gap of free) {
    let start = Math.ceil(gap.start / size) * size;
    while (start + size - 1 <= gap.end && starts.length < limit) { starts.push(start); start += size; }
    if (starts.length >= limit) break;
  }
  return starts;
}

// ---------------------------------------------------------------- inputs

/**
 * Turns the rows the service loads into allocations clipped to the parent.
 * - A child or in-scope subnet takes its whole CIDR.
 * - An IP row takes its address unless it is FREE *and* unlinked; any other
 *   state (OCCUPIED, RESERVED, EXCLUDED, UNKNOWN) is treated as taken, and so
 *   is a FREE row that is still linked to a device, interface or host.
 * - The parent's gateway takes its address.
 * Rows outside the parent, unparsable rows, the parent itself and supernets
 * of the parent are ignored.
 */
export function collectAllocations(parent: { network: number; broadcast: number; cidr: string }, input: { addresses?: PlanningAddressRow[]; subnets?: PlanningSubnetRow[]; gateway?: string | null }): PlanningAllocation[] {
  const out: PlanningAllocation[] = [];
  const inside = (value: number) => value >= parent.network && value <= parent.broadcast;
  for (const subnet of input.subnets ?? []) {
    const info = parseIpv4Cidr(subnet.cidr);
    if (!info) continue;
    // The parent itself and any supernet that contains it are not allocations inside it.
    if (info.network <= parent.network && info.broadcast >= parent.broadcast) continue;
    const start = Math.max(info.network, parent.network);
    const end = Math.min(info.broadcast, parent.broadcast);
    if (start > end) continue;
    out.push({ kind: 'SUBNET', start, end, label: subnet.hidden ? null : `${formatIpv4(info.network)}/${info.prefix}${subnet.purpose ? ` · ${subnet.purpose}` : ''}`, subnetId: subnet.hidden ? null : subnet.id ?? null });
  }
  for (const row of input.addresses ?? []) {
    const value = parseIpv4(row.address);
    if (value === null || !inside(value)) continue;
    const linked = Boolean(row.deviceId || row.interfaceId || row.hostId);
    if (row.state === 'FREE' && !linked) continue;
    out.push({ kind: row.state === 'RESERVED' || row.state === 'EXCLUDED' ? 'RESERVED' : 'HOST', start: value, end: value });
  }
  const gateway = input.gateway ? parseIpv4(input.gateway) : null;
  if (gateway !== null && inside(gateway)) out.push({ kind: 'GATEWAY', start: gateway, end: gateway, label: input.gateway });
  return out;
}

function overlapCount(items: Interval[], start: number, end: number) {
  return items.reduce((sum, item) => sum + Math.max(0, Math.min(item.end, end) - Math.max(item.start, start) + 1), 0);
}

/**
 * Aligned candidates of `prefix` inside the parent that overlap a blocker and start at or below `maxStart`.
 * A blocker subnet at least as large as a candidate becomes one grouped row (all the candidates it holds);
 * smaller blockers (hosts, the gateway, small subnets) mark the single candidate that contains them.
 * Works per blocker, so a large parent is never walked block by block.
 */
function skippedCandidates(network: number, broadcast: number, prefix: number, blockers: PlanningAllocation[], maxStart: number, cap: number) {
  const size = blockSize(prefix);
  const rows: Array<{ start: number; size: number; prefix: number; blocks: number; insideExisting: boolean; conflicts: PlanningConflict[] }> = [];
  if (cap <= 0) return { rows, truncated: blockers.length > 0 };
  // Outermost subnets only: a subnet nested in another one is already part of that group.
  const groups: Interval[] = [];
  for (const item of blockers.filter((b) => b.kind === 'SUBNET' && b.end - b.start + 1 >= size).sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (!groups.some((group) => item.start >= group.start && item.end <= group.end)) groups.push({ start: item.start, end: item.end });
  }
  const inGroup = (start: number) => groups.some((group) => start >= group.start && start + size - 1 <= group.end);
  const singles = new Set<number>();
  for (const item of blockers) {
    if (item.kind === 'SUBNET' && item.end - item.start + 1 >= size) continue;
    for (let start = Math.floor(item.start / size) * size; start <= item.end; start += size) if (start >= network && start + size - 1 <= broadcast && !inGroup(start)) singles.add(start);
  }
  const entries: Array<{ start: number; group?: Interval }> = [...groups.map((group) => ({ start: group.start, group })), ...[...singles].map((start) => ({ start }))].sort((a, b) => a.start - b.start);
  let truncated = false;
  for (const entry of entries) {
    if (entry.start > maxStart) break;
    if (rows.length >= cap) { truncated = true; break; }
    if (entry.group) {
      const groupSize = entry.group.end - entry.group.start + 1;
      const conflicts = blockConflicts(entry.group.start, entry.group.end, blockers).filter((item) => item.kind === 'SUBNET');
      rows.push({ start: entry.group.start, size: groupSize, prefix, blocks: groupSize / size, insideExisting: true, conflicts });
    } else rows.push({ start: entry.start, size, prefix, blocks: 1, insideExisting: false, conflicts: blockConflicts(entry.start, entry.start + size - 1, blockers) });
  }
  return { rows, truncated };
}

// ---------------------------------------------------------------- plan

/**
 * Builds the planning preview for one IPv4 parent.
 *
 * Requests are placed largest block first (shortest prefix), each lowest
 * address first, and every placed block is added to the taken space before
 * the next one, so planned blocks never overlap each other either. Placing the
 * largest aligned blocks first is what keeps power-of-two allocations from
 * fragmenting the space the bigger blocks need.
 *
 * `count` null/undefined means "as many as fit" (capped at MAX_PLANNED_BLOCKS).
 */
export function planIpv4Subnet(cidr: string, allocations: PlanningAllocation[], requests: PlanningRequest[] = []) {
  const info = parseIpv4Cidr(cidr);
  if (!info) throw new Error(`Invalid IPv4 CIDR: ${cidr}`);
  const { network, broadcast, prefix: parentPrefix } = info;

  const clipped = allocations
    .map((item) => ({ ...item, start: Math.max(item.start, network), end: Math.min(item.end, broadcast) }))
    .filter((item) => item.start <= item.end);
  const taken = mergeIntervals(clipped);

  // --- host-level view of the parent used as a flat segment (kept for compatibility).
  const first = parentPrefix >= 31 ? network : network + 1;
  const last = parentPrefix >= 31 ? broadcast : broadcast - 1;
  const usableTotal = Math.max(0, last - first + 1);
  const usableGapsRaw = usableTotal ? complement(first, last, taken) : [];
  const freeUsable = usableGapsRaw.reduce((sum, gap) => sum + gap.end - gap.start + 1, 0);
  const unavailable = usableTotal - freeUsable;
  const unavailableAddresses = clipped.filter((item) => item.kind !== 'SUBNET' && item.start >= first && item.start <= last).map((item) => item.start);

  // --- block placement
  const planned: Array<{ start: number; prefix: number }> = [];
  const shortfalls: PlanningShortfall[] = [];
  let occupied = taken;
  const ordered = requests
    .map((request, index) => ({ ...request, index }))
    .sort((a, b) => a.prefix - b.prefix || a.index - b.index);
  const skippedRaw: Array<{ start: number; size: number; prefix: number; blocks: number; insideExisting: boolean; conflicts: PlanningConflict[] }> = [];
  let skippedTruncated = false;
  for (const request of ordered) {
    const requested = request.count ?? null;
    if (request.prefix < parentPrefix) { shortfalls.push({ prefix: request.prefix, requested, planned: 0, missing: requested, reason: 'PREFIX_SHORTER_THAN_PARENT' }); continue; }
    const remaining = MAX_PLANNED_BLOCKS - planned.length;
    const limit = requested === null ? remaining : Math.min(requested, remaining);
    const free = complement(network, broadcast, occupied);
    // Ask for one more than the limit so a capped "as many as fit" run knows it was cut short.
    const starts = placeAligned(free, request.prefix, limit + 1);
    const placed = starts.slice(0, limit);
    // What this request had to step over: existing allocations plus blocks planned by earlier (larger) requests.
    const blockers: PlanningAllocation[] = [...clipped, ...planned.map((block) => ({ kind: 'SUBNET' as const, start: block.start, end: block.start + blockSize(block.prefix) - 1, label: `${formatIpv4(block.start)}/${block.prefix} (planeado)` }))];
    for (const start of placed) planned.push({ start, prefix: request.prefix });
    occupied = mergeIntervals([...occupied, ...placed.map((start) => ({ start, end: start + blockSize(request.prefix) - 1 }))]);
    const truncated = starts.length > limit && (requested === null || requested > remaining);
    // Skipped candidates: all of them when the request was not fully met (or had no count), otherwise only those
    // below the last placed block, the ones placement actually passed over.
    const exhaustive = !truncated && (requested === null || placed.length < requested);
    const below = exhaustive ? broadcast : placed.length ? placed[placed.length - 1] - 1 : network - 1;
    const found = skippedCandidates(network, broadcast, request.prefix, blockers, below, MAX_SKIPPED_BLOCKS - skippedRaw.length);
    skippedRaw.push(...found.rows);
    if (found.truncated) skippedTruncated = true;
    if (truncated) shortfalls.push({ prefix: request.prefix, requested, planned: placed.length, missing: requested === null ? null : requested - placed.length, reason: 'TRUNCATED' });
    else if (requested !== null && placed.length < requested) shortfalls.push({ prefix: request.prefix, requested, planned: placed.length, missing: requested - placed.length, reason: placed.length ? 'NOT_ENOUGH_FREE_SPACE' : 'NO_FREE_ALIGNED_BLOCK' });
    else if (requested === null && placed.length === 0) shortfalls.push({ prefix: request.prefix, requested, planned: 0, missing: null, reason: 'NO_FREE_ALIGNED_BLOCK' });
  }
  planned.sort((a, b) => a.start - b.start);
  const plannedBlocks: PlannedBlock[] = planned.map((block) => {
    const size = blockSize(block.prefix);
    return { cidr: `${formatIpv4(block.start)}/${block.prefix}`, prefix: block.prefix, start: formatIpv4(block.start), end: formatIpv4(block.start + size - 1), size, usable: usableInBlock(block.prefix) };
  });

  // --- the parent map: every address of the parent in order, as FREE / TAKEN / PLANNED rows.
  const marks: Array<Interval & { status: 'TAKEN' | 'PLANNED' | 'RESERVED'; kinds?: PlanningAllocationKind[]; label?: string | null; subnetId?: string | null }> = [];
  for (const block of planned) marks.push({ start: block.start, end: block.start + blockSize(block.prefix) - 1, status: 'PLANNED' });
  // Subnets keep their own row; host-level rows next to each other are merged into one run.
  const subnets = clipped.filter((item) => item.kind === 'SUBNET').sort((a, b) => a.start - b.start);
  for (const item of subnets) marks.push({ start: item.start, end: item.end, status: 'TAKEN', kinds: ['SUBNET'], label: item.label ?? null, subnetId: item.subnetId ?? null });
  const subnetIntervals = mergeIntervals(subnets);
  const singles = clipped.filter((item) => item.kind !== 'SUBNET' && !subnetIntervals.some((s) => item.start >= s.start && item.end <= s.end)).sort((a, b) => a.start - b.start);
  for (const item of singles) {
    const lastMark = marks[marks.length - 1];
    if (lastMark && lastMark.status === 'TAKEN' && !lastMark.kinds?.includes('SUBNET') && item.start <= lastMark.end + 1) {
      lastMark.end = Math.max(lastMark.end, item.end);
      if (!lastMark.kinds!.includes(item.kind)) lastMark.kinds!.push(item.kind);
      if (item.kind === 'GATEWAY') lastMark.label = item.label ?? lastMark.label;
    } else marks.push({ start: item.start, end: item.end, status: 'TAKEN', kinds: [item.kind], label: item.kind === 'GATEWAY' ? item.label ?? null : null });
  }
  // The parent's network and broadcast addresses (parents up to /30) count as unavailable in Utilização, so the map
  // shows them as reserved rather than free, unless something else (a subnet, a host, a planned block) already covers them.
  const plannedIntervals = planned.map((block) => ({ start: block.start, end: block.start + blockSize(block.prefix) - 1 }));
  const covered = (value: number) => taken.some((item) => value >= item.start && value <= item.end) || plannedIntervals.some((item) => value >= item.start && value <= item.end);
  const edges = parentPrefix >= 31 ? [] : [{ value: network, label: 'Endereço de rede' }, { value: broadcast, label: 'Endereço de broadcast' }].filter((edge) => !covered(edge.value));
  for (const edge of edges) marks.push({ start: edge.value, end: edge.value, status: 'RESERVED', label: edge.label });
  marks.sort((a, b) => a.start - b.start || b.end - a.end);

  // Skipped candidates that do not sit inside an existing subnet get one conflict row covering the whole block.
  const conflictRows = skippedRaw.filter((item) => !item.insideExisting && !plannedIntervals.some((p) => p.start <= item.start + item.size - 1 && item.start <= p.end)).sort((a, b) => a.start - b.start);
  const segments: PlanningMapSegment[] = [];
  const pushFree = (start: number, end: number) => { if (start <= end) segments.push({ status: 'FREE', start: formatIpv4(start), end: formatIpv4(end), count: end - start + 1, cidrs: rangeToCidrs(start, end) }); };
  const emitRange = (from: number, to: number) => {
    let cursor = from;
    for (const mark of marks) {
      if (mark.end < cursor || mark.start > to) continue; // outside the range, or fully covered by an earlier (overlapping) subnet row
      const start = Math.max(mark.start, cursor);
      const end = Math.min(mark.end, to);
      pushFree(cursor, start - 1);
      const exact = rangeToCidrs(start, end);
      segments.push({ status: mark.status, start: formatIpv4(start), end: formatIpv4(end), count: end - start + 1, cidrs: exact.length === 1 && mark.status !== 'RESERVED' ? exact : [], ...(mark.kinds ? { kinds: mark.kinds } : {}), ...(mark.label !== undefined ? { label: mark.label } : {}), ...(mark.subnetId ? { subnetId: mark.subnetId } : {}) });
      cursor = end + 1;
      if (cursor > to) return;
    }
    pushFree(cursor, to);
  };
  let from = network;
  for (const row of conflictRows) {
    const end = row.start + row.size - 1;
    if (row.start > from) emitRange(from, row.start - 1);
    const takenHere = overlapCount(taken, row.start, end);
    const reservedHere = edges.filter((edge) => edge.value >= row.start && edge.value <= end).length;
    segments.push({ status: 'CONFLICT', start: formatIpv4(row.start), end: formatIpv4(end), count: row.size, cidrs: [`${formatIpv4(row.start)}/${row.prefix}`], label: row.conflicts.map((item) => item.label).join(' · '), conflicts: row.conflicts, breakdown: { taken: takenHere, reserved: reservedHere, free: row.size - takenHere - reservedHere } });
    from = end + 1;
  }
  if (from <= broadcast) emitRange(from, broadcast);
  const segmentsTruncated = segments.length > MAX_MAP_SEGMENTS;

  const parentSize = blockSize(parentPrefix);
  const takenCount = taken.reduce((sum, item) => sum + item.end - item.start + 1, 0);
  const plannedCount = planned.reduce((sum, block) => sum + blockSize(block.prefix), 0);

  return {
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    prefix: parentPrefix,
    size: parentSize,
    usableRange: usableTotal ? { start: formatIpv4(first), end: formatIpv4(last) } : null,
    usableTotal,
    unavailable,
    free: freeUsable,
    utilizationPercent: usableTotal ? Math.round((unavailable / usableTotal) * 10000) / 100 : 0,
    usableGaps: usableGapsRaw.map((gap) => ({ start: formatIpv4(gap.start), end: formatIpv4(gap.end), count: gap.end - gap.start + 1 })),
    unavailableAddresses: [...new Set(unavailableAddresses)].sort((a, b) => a - b).map(formatIpv4),
    childSubnets: subnets.length,
    // reserved: the parent's network/broadcast not already covered by an allocation or a planned block. With no plan,
    // freeAfterPlan equals `free` (Utilização); the map's FREE rows plus each CONFLICT row's breakdown.free add up to it.
    addressSpace: { total: parentSize, taken: takenCount, reserved: edges.length, planned: plannedCount, freeAfterPlan: parentSize - takenCount - edges.length - plannedCount },
    requests: requests.map((request) => ({ prefix: request.prefix, count: request.count ?? null })),
    planned: plannedBlocks,
    skipped: skippedRaw.sort((a, b) => a.start - b.start).map((item): SkippedBlock => ({ cidr: rangeToCidrs(item.start, item.start + item.size - 1)[0], prefix: item.prefix, start: formatIpv4(item.start), end: formatIpv4(item.start + item.size - 1), size: item.size, blocks: item.blocks, insideExisting: item.insideExisting, conflicts: item.conflicts })),
    skippedTruncated,
    shortfalls,
    segments: segmentsTruncated ? segments.slice(0, MAX_MAP_SEGMENTS) : segments,
    segmentsTruncated,
  };
}

/**
 * Validates the `prefix` / `count` query of the planning endpoint.
 * Returns [] when no prefix is given (analysis only), or an error message.
 */
export function parsePlanningQuery(prefixText?: string, countText?: string): { requests: PlanningRequest[] } | { error: string } {
  if (prefixText === undefined || prefixText === '') {
    if (countText !== undefined && countText !== '') return { error: 'Indica o prefixo dos blocos a planear.' };
    return { requests: [] };
  }
  const cleaned = prefixText.trim().replace(/^\//, '');
  if (!/^\d{1,2}$/.test(cleaned) || Number(cleaned) > 32) return { error: 'O prefixo tem de ser um número entre 0 e 32.' };
  if (countText === undefined || countText === '' || countText === 'all') return { requests: [{ prefix: Number(cleaned), count: null }] };
  if (!/^\d{1,5}$/.test(countText.trim()) || Number(countText) < 1 || Number(countText) > MAX_PLANNED_BLOCKS) return { error: `A quantidade tem de ser um número entre 1 e ${MAX_PLANNED_BLOCKS}.` };
  return { requests: [{ prefix: Number(cleaned), count: Number(countText) }] };
}

// ---------------------------------------------------------------- conflicts, split preview, commit validation

export type PlanningConflict = { kind: PlanningAllocationKind; start: string; end: string; count: number; label: string; subnetId?: string };

const kindNoun: Record<PlanningAllocationKind, [string, string]> = { SUBNET: ['Subnet', 'Subnets'], HOST: ['Host', 'Hosts'], RESERVED: ['Endereço reservado/excluído', 'Endereços reservados/excluídos'], GATEWAY: ['Gateway', 'Gateway'] };

/**
 * What inside [start, end] is already taken, named so the user can see why a
 * block is not available: each overlapping subnet by CIDR (and purpose), and
 * host-level rows merged into runs of the same kind.
 */
export function blockConflicts(start: number, end: number, allocations: PlanningAllocation[]): PlanningConflict[] {
  const hits = allocations.filter((item) => item.start <= end && item.end >= start);
  const out: PlanningConflict[] = [];
  for (const item of hits.filter((hit) => hit.kind === 'SUBNET').sort((a, b) => a.start - b.start)) {
    out.push({ kind: 'SUBNET', start: formatIpv4(item.start), end: formatIpv4(item.end), count: item.end - item.start + 1, label: item.label ? `Subnet ${item.label}` : `Subnet ${rangeToCidrs(item.start, item.end).join(', ')} (sem acesso)`, ...(item.subnetId ? { subnetId: item.subnetId } : {}) });
  }
  for (const kind of ['GATEWAY', 'HOST', 'RESERVED'] as const) {
    const values = [...new Set(hits.filter((hit) => hit.kind === kind).flatMap((hit) => { const list: number[] = []; for (let v = Math.max(hit.start, start); v <= Math.min(hit.end, end); v++) list.push(v); return list; }))].sort((a, b) => a - b);
    let runStart: number | null = null;
    for (let i = 0; i < values.length; i++) {
      if (runStart === null) runStart = values[i];
      if (i === values.length - 1 || values[i + 1] !== values[i] + 1) {
        const count = values[i] - runStart + 1;
        const [one, many] = kindNoun[kind];
        out.push({ kind, start: formatIpv4(runStart), end: formatIpv4(values[i]), count, label: count === 1 ? `${one} ${formatIpv4(runStart)}` : `${many} ${formatIpv4(runStart)} – ${formatIpv4(values[i])} (${count})` });
        runStart = null;
      }
    }
  }
  return out;
}

/** The most rows the split preview returns (a /24 into /32s would be 256, a /16 into /27s 2048). */
export const MAX_SPLIT_ROWS = 256;

export type SplitBlock = { cidr: string; start: string; end: string; size: number; usable: number; used: number; free: number; available: boolean; planned: boolean; conflicts: PlanningConflict[] };

/**
 * Split preview: every aligned block of `prefix` in the parent, in order, with
 * how many of its addresses are taken and what takes them. `plannedCidrs`
 * marks the ones the plan would create.
 */
export function splitPreview(cidr: string, allocations: PlanningAllocation[], prefix: number, plannedCidrs: Set<string> = new Set()) {
  const info = parseIpv4Cidr(cidr);
  if (!info || prefix < info.prefix || prefix > 32) return { rows: [] as SplitBlock[], total: 0, truncated: false };
  const size = blockSize(prefix);
  const total = blockSize(info.prefix) / size;
  const taken = mergeIntervals(allocations.map((item) => ({ start: Math.max(item.start, info.network), end: Math.min(item.end, info.broadcast) })).filter((item) => item.start <= item.end));
  const rows: SplitBlock[] = [];
  for (let start = info.network; start <= info.broadcast && rows.length < MAX_SPLIT_ROWS; start += size) {
    const end = start + size - 1;
    const used = taken.reduce((sum, item) => sum + Math.max(0, Math.min(item.end, end) - Math.max(item.start, start) + 1), 0);
    const blockCidr = `${formatIpv4(start)}/${prefix}`;
    rows.push({ cidr: blockCidr, start: formatIpv4(start), end: formatIpv4(end), size, usable: usableInBlock(prefix), used, free: size - used, available: used === 0, planned: plannedCidrs.has(blockCidr), conflicts: used ? blockConflicts(start, end, allocations) : [] });
  }
  return { rows, total, truncated: total > rows.length };
}

/** The most blocks one commit may create. */
export const MAX_COMMIT_BLOCKS = 64;

export type CommitBlockInput = { cidr: string; purpose?: string | null };
export type CommitBlockProblem = { cidr: string; reason: 'INVALID_CIDR' | 'NOT_ALIGNED' | 'OUTSIDE_PARENT' | 'NOT_SMALLER_THAN_PARENT' | 'DUPLICATE_IN_REQUEST' | 'OVERLAPS_REQUEST' | 'OVERLAPS_EXISTING' | 'CIDR_EXISTS_ELSEWHERE'; message: string; conflicts: PlanningConflict[] };

/**
 * Checks blocks the user confirmed against the parent and what is taken *now*.
 * Returns every problem (not just the first) so the UI can explain them all.
 * `existingCidrs` are CIDRs already stored anywhere: `Subnet.cidr` is unique
 * across the whole database, independently of site and VRF.
 */
export function validateCommitBlocks(parentCidr: string, allocations: PlanningAllocation[], blocks: CommitBlockInput[], existingCidrs: Set<string> = new Set()) {
  const parent = parseIpv4Cidr(parentCidr);
  if (!parent) throw new Error(`Invalid IPv4 CIDR: ${parentCidr}`);
  const problems: CommitBlockProblem[] = [];
  const accepted: Array<{ cidr: string; start: number; end: number; prefix: number; purpose: string | null }> = [];
  const seen = new Map<string, number>();
  for (const block of blocks) {
    const raw = String(block.cidr ?? '').trim();
    const info = parseIpv4Cidr(raw);
    if (!info) { problems.push({ cidr: raw, reason: 'INVALID_CIDR', message: `${raw || '(vazio)'} não é um CIDR IPv4 válido.`, conflicts: [] }); continue; }
    const cidr = `${formatIpv4(info.network)}/${info.prefix}`;
    if (parseIpv4(raw.split('/')[0]) !== info.network) { problems.push({ cidr: raw, reason: 'NOT_ALIGNED', message: `${raw} não está alinhado: um /${info.prefix} começa em ${cidr.split('/')[0]}.`, conflicts: [] }); continue; }
    if (info.prefix <= parent.prefix) { problems.push({ cidr, reason: 'NOT_SMALLER_THAN_PARENT', message: `${cidr} não é mais pequeno do que a subnet pai ${parentCidr}.`, conflicts: [] }); continue; }
    if (info.network < parent.network || info.broadcast > parent.broadcast) { problems.push({ cidr, reason: 'OUTSIDE_PARENT', message: `${cidr} não pertence a ${parentCidr}.`, conflicts: [] }); continue; }
    if (seen.has(cidr)) { problems.push({ cidr, reason: 'DUPLICATE_IN_REQUEST', message: `${cidr} aparece mais do que uma vez.`, conflicts: [] }); continue; }
    seen.set(cidr, 1);
    const clash = accepted.find((other) => other.start <= info.broadcast && info.network <= other.end);
    if (clash) { problems.push({ cidr, reason: 'OVERLAPS_REQUEST', message: `${cidr} sobrepõe ${clash.cidr}, também pedido.`, conflicts: [] }); continue; }
    const conflicts = blockConflicts(info.network, info.broadcast, allocations);
    if (conflicts.length) { problems.push({ cidr, reason: 'OVERLAPS_EXISTING', message: `${cidr} já não está livre: ${conflicts.map((item) => item.label).join('; ')}.`, conflicts }); continue; }
    if (existingCidrs.has(cidr)) { problems.push({ cidr, reason: 'CIDR_EXISTS_ELSEWHERE', message: `A subnet ${cidr} já existe noutro Site ou VRF.`, conflicts: [] }); continue; }
    accepted.push({ cidr, start: info.network, end: info.broadcast, prefix: info.prefix, purpose: block.purpose?.trim() || null });
  }
  return { accepted, problems };
}
