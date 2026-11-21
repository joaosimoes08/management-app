/**
 * Pure graph helpers for topology impact analysis (Step 34).
 *
 * Documented connections are treated as undirected: the stored source/target order depends on how a link was drawn or
 * discovered, not on which side is upstream. "Downstream" is therefore defined against anchors: a device is affected
 * when it loses every documented path to an anchor (by default the site's routers and firewalls) once the failed set is
 * removed. Every traversal keeps a visited set and a hop limit, so loops and very large graphs cannot hang a request.
 */
export type ImpactEdge = { id: string; a: string; b: string };
export type ImpactAnchorMode = 'explicit' | 'gateway-devices' | 'largest-segment';

export const DEFAULT_MAX_DEPTH = 12;
export const MAX_DEPTH_LIMIT = 32;

export function clampDepth(value: unknown, fallback = DEFAULT_MAX_DEPTH) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_DEPTH_LIMIT, Math.trunc(parsed)));
}

export function adjacency(edges: ImpactEdge[]) {
  const map = new Map<string, { node: string; edge: string }[]>();
  const add = (from: string, to: string, edge: string) => { const list = map.get(from); if (list) list.push({ node: to, edge }); else map.set(from, [{ node: to, edge }]); };
  for (const edge of edges) { if (edge.a === edge.b) continue; add(edge.a, edge.b, edge.id); add(edge.b, edge.a, edge.id); }
  return map;
}

/** Nodes reachable from `starts` without stepping on `blocked` (plain BFS, visited set, no depth limit needed for correctness). */
export function reachable(adj: Map<string, { node: string; edge: string }[]>, starts: Iterable<string>, blocked: Set<string>) {
  const seen = new Set<string>(); const queue: string[] = [];
  for (const start of starts) if (!blocked.has(start) && !seen.has(start)) { seen.add(start); queue.push(start); }
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of adj.get(queue[index]) ?? []) if (!blocked.has(next.node) && !seen.has(next.node)) { seen.add(next.node); queue.push(next.node); }
  }
  return seen;
}

export type ImpactResult = {
  affected: { deviceId: string; hops: number; viaDeviceId: string; viaConnectionId: string }[];
  anchorMode: ImpactAnchorMode;
  anchors: string[];
  truncated: boolean;
};

/**
 * Devices that lose every path to an anchor when `failed` goes down, listed up to `maxDepth` hops from the failed set.
 * Anchors inside the failed set are ignored. With no anchors at all, the largest surviving segment next to the failure
 * stands in for "the rest of the network" (anchorMode largest-segment).
 */
export function computeImpact(input: { edges: ImpactEdge[]; failed: Iterable<string>; anchors?: Iterable<string>; anchorMode?: ImpactAnchorMode; maxDepth?: number }): ImpactResult {
  const failed = new Set(input.failed); const adj = adjacency(input.edges); const maxDepth = clampDepth(input.maxDepth);
  let anchorMode: ImpactAnchorMode = input.anchorMode ?? 'explicit';
  let anchors = [...new Set(input.anchors ?? [])].filter((id) => !failed.has(id));
  if (!anchors.length) {
    anchorMode = 'largest-segment';
    const neighbours = [...failed].flatMap((id) => (adj.get(id) ?? []).map((item) => item.node)).filter((id) => !failed.has(id));
    const assigned = new Set<string>(); let best: string[] = [];
    for (const start of neighbours.sort()) {
      if (assigned.has(start)) continue;
      const segment = [...reachable(adj, [start], failed)]; segment.forEach((id) => assigned.add(id));
      if (segment.length > best.length) best = segment;
    }
    anchors = best.length ? [best.slice().sort()[0]] : [];
  }
  const safe = reachable(adj, anchors, failed);
  const hops = new Map<string, { hops: number; via: string; edge: string }>(); const queue: string[] = [];
  for (const id of [...failed].sort()) { hops.set(id, { hops: 0, via: '', edge: '' }); queue.push(id); }
  let truncated = false;
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]; const depth = hops.get(current)!.hops;
    for (const next of adj.get(current) ?? []) {
      if (hops.has(next.node) || safe.has(next.node)) continue;
      if (depth >= maxDepth) { truncated = true; continue; }
      hops.set(next.node, { hops: depth + 1, via: current, edge: next.edge }); queue.push(next.node);
    }
  }
  const affected = [...hops.entries()].filter(([id]) => !failed.has(id)).map(([deviceId, item]) => ({ deviceId, hops: item.hops, viaDeviceId: item.via, viaConnectionId: item.edge }))
    .sort((left, right) => left.hops - right.hops || left.deviceId.localeCompare(right.deviceId));
  return { affected, anchorMode, anchors, truncated };
}

/** Shortest documented path (fewest hops) between two devices, or null when none exists within `maxDepth` hops. */
export function shortestPath(edges: ImpactEdge[], from: string, to: string, maxDepth?: number) {
  const limit = clampDepth(maxDepth);
  if (from === to) return { deviceIds: [from], connectionIds: [] as string[] };
  const adj = adjacency(edges); const previous = new Map<string, { node: string; edge: string; depth: number }>([[from, { node: '', edge: '', depth: 0 }]]); const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]; const depth = previous.get(current)!.depth;
    if (depth >= limit) continue;
    for (const next of [...(adj.get(current) ?? [])].sort((left, right) => left.node.localeCompare(right.node) || left.edge.localeCompare(right.edge))) {
      if (previous.has(next.node)) continue;
      previous.set(next.node, { node: current, edge: next.edge, depth: depth + 1 });
      if (next.node === to) {
        const deviceIds = [to]; const connectionIds: string[] = []; let cursor = to;
        while (cursor !== from) { const step = previous.get(cursor)!; connectionIds.unshift(step.edge); deviceIds.unshift(step.node); cursor = step.node; }
        return { deviceIds, connectionIds };
      }
      queue.push(next.node);
    }
  }
  return null;
}

/** Host part of an application URL, lower-cased; null when the URL cannot be parsed. */
export function urlHost(url: string) {
  try { return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return null; }
}

const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:.]*)$/i;

/** True when `host` names one of `names` exactly, or by short name (first DNS label) when one side is unqualified. IPs match exactly only. */
export function hostMatches(host: string, names: Set<string>) {
  if (names.has(host)) return true;
  if (IP_LITERAL.test(host)) return false;
  if (host.includes('.')) return names.has(host.split('.')[0]);
  for (const name of names) if (!IP_LITERAL.test(name) && name.split('.')[0] === host) return true;
  return false;
}
