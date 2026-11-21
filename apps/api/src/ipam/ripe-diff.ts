import * as net from 'node:net';

/**
 * Pure helpers for the RIPE "paste/upload → preview diff → confirm import"
 * flow. No database access here, so the classification is unit-testable.
 */

export type ParsedPrefix = { input: string; prefix: string; version: 4 | 6; start: bigint; end: bigint };
export type InvalidPrefix = { input: string; reason: 'INVALID_CIDR' | 'MISSING_PREFIX_LENGTH'; message: string };
export type ParsedPrefixList = { valid: ParsedPrefix[]; invalid: InvalidPrefix[]; duplicates: string[]; normalized: Array<{ input: string; prefix: string }> };

export type ExistingSubnet = { id: string; cidr: string; siteId: string | null; vrfId: string | null; purpose: string | null; environment: string | null; visible: boolean };
export type DiffTarget = { siteId: string; vrfId?: string | null; purpose?: string | null; environment?: string | null };
export type DiffStatus = 'new' | 'changed' | 'exists' | 'conflict';
export type DiffReason = 'NEW' | 'NEW_OVERLAPS_OTHER_SCOPE' | 'EXISTS_SAME' | 'EXISTS_DIFFERENT_ATTRIBUTES' | 'OVERLAP' | 'EXISTS_OUTSIDE_SITE';
export type SubnetRef = { id: string; cidr: string; siteId: string | null; vrfId: string | null; purpose: string | null; environment: string | null } | { id: null; cidr: null; hidden: true };
export type DiffItem = {
  prefix: string;
  input: string;
  version: 4 | 6;
  status: DiffStatus;
  reason: DiffReason;
  message: string;
  importable: boolean;
  existing?: SubnetRef;
  changes?: Array<{ field: 'vrfId' | 'purpose' | 'environment'; current: string | null; proposed: string | null }>;
  /** `source: 'existing'` = a subnet already in the inventory; `source: 'paste'` = an earlier prefix of this same paste. */
  overlaps?: Array<{ source: 'existing'; relation: 'contains' | 'within'; sameScope: boolean; subnet: SubnetRef } | { source: 'paste'; relation: 'contains' | 'within'; sameScope: true; prefix: string }>;
};

const SPLIT = /[\s,;]+/;

function ipv4ToBigInt(address: string) {
  return address.split('.').reduce((n, part) => n * 256n + BigInt(Number(part)), 0n);
}
function ipv6ToBigInt(address: string) {
  const [left, right] = address.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right !== undefined && right !== '' ? right.split(':') : [];
  const parts = right === undefined ? leftParts : [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill('0'), ...rightParts];
  return parts.reduce((n, part) => (n << 16n) + BigInt(parseInt(part || '0', 16)), 0n);
}
function bigIntToIpv4(value: bigint) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.');
}
function bigIntToIpv6(value: bigint) {
  const parts = Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16));
  let bestStart = -1; let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (parts[i] !== '0') { i++; continue; }
    const start = i; while (i < 8 && parts[i] === '0') i++;
    if (i - start > bestLength) { bestStart = start; bestLength = i - start; }
  }
  if (bestLength > 1) return `${parts.slice(0, bestStart).join(':')}::${parts.slice(bestStart + bestLength).join(':')}`;
  return parts.join(':');
}

/** Parses one CIDR, normalising host bits away (10.0.0.1/24 → 10.0.0.0/24). Returns null when invalid. */
export function parseCidr(input: string): Omit<ParsedPrefix, 'input'> | null {
  const [address, prefixText, extra] = input.trim().split('/');
  if (extra !== undefined || prefixText === undefined || !/^\d{1,3}$/.test(prefixText)) return null;
  const version = net.isIP(address);
  if (version !== 4 && version !== 6) return null;
  if (version === 6 && address.includes('.')) return null; // embedded IPv4 notation is not supported
  const bits = version === 4 ? 32 : 128;
  const length = Number(prefixText);
  if (length > bits) return null;
  const value = version === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  const hostBits = BigInt(bits - length);
  const start = (value >> hostBits) << hostBits;
  const end = start + (1n << hostBits) - 1n;
  return { version, prefix: `${version === 4 ? bigIntToIpv4(start) : bigIntToIpv6(start)}/${length}`, start, end };
}

/** Splits pasted text, validates, normalises and de-duplicates. Order of first appearance is kept. */
export function parsePrefixList(items: string[]): ParsedPrefixList {
  const tokens = items.flatMap((item) => item.split(SPLIT)).map((token) => token.trim()).filter(Boolean);
  const valid: ParsedPrefix[] = []; const invalid: InvalidPrefix[] = []; const duplicates: string[] = []; const normalized: Array<{ input: string; prefix: string }> = [];
  const seen = new Set<string>();
  for (const input of tokens) {
    const parsed = parseCidr(input);
    if (!parsed) {
      const missingLength = !input.includes('/') && net.isIP(input) !== 0;
      invalid.push({ input, reason: missingLength ? 'MISSING_PREFIX_LENGTH' : 'INVALID_CIDR', message: missingLength ? 'Falta o comprimento do prefixo (ex.: /24).' : 'Não é um prefixo IPv4/IPv6 válido em notação CIDR.' });
      continue;
    }
    if (seen.has(parsed.prefix)) { duplicates.push(input); continue; }
    seen.add(parsed.prefix);
    if (parsed.prefix !== input) normalized.push({ input, prefix: parsed.prefix });
    valid.push({ input, ...parsed });
  }
  return { valid, invalid, duplicates, normalized };
}

export function countTokens(items: string[]) {
  return items.flatMap((item) => item.split(SPLIT)).filter((token) => token.trim()).length;
}

function ref(subnet: ExistingSubnet): SubnetRef {
  if (!subnet.visible) return { id: null, cidr: null, hidden: true };
  return { id: subnet.id, cidr: subnet.cidr, siteId: subnet.siteId, vrfId: subnet.vrfId, purpose: subnet.purpose, environment: subnet.environment };
}

/**
 * Classifies each prefix against the subnets the import would collide with.
 * Mirrors createSubnet's rules: CIDR is globally unique, and overlaps are only
 * refused inside the same Site + VRF. Prefixes of the same paste all target
 * that Site + VRF, so a prefix overlapping an earlier importable prefix of the
 * paste is also a conflict (the first one in the list wins).
 */
export function diffPrefixes(prefixes: ParsedPrefix[], subnets: ExistingSubnet[], target: DiffTarget): DiffItem[] {
  const targetVrf = target.vrfId || null;
  const ranges = subnets.map((subnet) => ({ subnet, range: parseCidr(subnet.cidr) })).filter((entry): entry is { subnet: ExistingSubnet; range: NonNullable<ReturnType<typeof parseCidr>> } => Boolean(entry.range));
  const accepted: ParsedPrefix[] = [];
  const relation = (outer: { start: bigint; end: bigint }, inner: { start: bigint; end: bigint }) => (outer.start <= inner.start && outer.end >= inner.end ? 'within' : 'contains') as 'within' | 'contains';
  return prefixes.map((item) => {
    const result = classify(item);
    if (result.importable) accepted.push(item);
    return result;
  });
  function classify(item: ParsedPrefix): DiffItem {
    const base = { prefix: item.prefix, input: item.input, version: item.version };
    const exact = ranges.find((entry) => entry.range.version === item.version && entry.range.start === item.start && entry.range.end === item.end);
    if (exact) {
      const subnet = exact.subnet;
      if (subnet.siteId !== target.siteId) {
        return { ...base, status: 'conflict', reason: 'EXISTS_OUTSIDE_SITE', importable: false, existing: ref(subnet), message: 'Este prefixo já existe noutro Site ou sem Site; os CIDR são únicos na aplicação.' } satisfies DiffItem;
      }
      const changes: NonNullable<DiffItem['changes']> = [];
      if ((subnet.vrfId ?? null) !== targetVrf) changes.push({ field: 'vrfId', current: subnet.vrfId ?? null, proposed: targetVrf });
      if (target.purpose !== undefined && target.purpose !== null && (subnet.purpose ?? null) !== target.purpose) changes.push({ field: 'purpose', current: subnet.purpose ?? null, proposed: target.purpose });
      if (target.environment !== undefined && target.environment !== null && (subnet.environment ?? null) !== target.environment) changes.push({ field: 'environment', current: subnet.environment ?? null, proposed: target.environment });
      // Like `existing`, the attribute values of a subnet the user cannot read stay hidden.
      if (changes.length) return { ...base, status: 'changed', reason: 'EXISTS_DIFFERENT_ATTRIBUTES', importable: false, existing: ref(subnet), ...(subnet.visible ? { changes } : {}), message: 'O prefixo já existe neste Site com atributos diferentes; a importação não altera subnets existentes.' } satisfies DiffItem;
      return { ...base, status: 'exists', reason: 'EXISTS_SAME', importable: false, existing: ref(subnet), message: 'O prefixo já existe neste Site com os mesmos atributos.' } satisfies DiffItem;
    }
    const overlaps = ranges
      .filter((entry) => entry.range.version === item.version && entry.range.start <= item.end && item.start <= entry.range.end)
      .map((entry) => ({ source: 'existing' as const, relation: relation(entry.range, item), sameScope: entry.subnet.siteId === target.siteId && (entry.subnet.vrfId ?? null) === targetVrf, subnet: ref(entry.subnet) }));
    const pasted = accepted
      .filter((other) => other.version === item.version && other.start <= item.end && item.start <= other.end)
      .map((other) => ({ source: 'paste' as const, relation: relation(other, item), sameScope: true as const, prefix: other.prefix }));
    if (overlaps.some((overlap) => overlap.sameScope)) {
      return { ...base, status: 'conflict', reason: 'OVERLAP', importable: false, overlaps: [...overlaps, ...pasted], message: 'Sobrepõe uma subnet existente no mesmo Site/VRF.' } satisfies DiffItem;
    }
    if (pasted.length) {
      return { ...base, status: 'conflict', reason: 'OVERLAP', importable: false, overlaps: [...overlaps, ...pasted], message: `Sobrepõe ${pasted.map((other) => other.prefix).join(', ')}, que aparece antes nesta lista.` } satisfies DiffItem;
    }
    if (overlaps.length) return { ...base, status: 'new', reason: 'NEW_OVERLAPS_OTHER_SCOPE', importable: true, overlaps, message: 'Novo neste Site/VRF; sobrepõe subnets de outro Site ou VRF (permitido).' } satisfies DiffItem;
    return { ...base, status: 'new', reason: 'NEW', importable: true, message: 'Prefixo novo.' } satisfies DiffItem;
  }
}

export function summarizeDiff(diff: DiffItem[], invalid: number, duplicates: number) {
  const count = (status: DiffStatus) => diff.filter((item) => item.status === status).length;
  return { total: diff.length, new: count('new'), changed: count('changed'), exists: count('exists'), conflict: count('conflict'), importable: diff.filter((item) => item.importable).length, invalid, duplicates };
}
