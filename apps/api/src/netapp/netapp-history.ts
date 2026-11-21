import type { OntapSnapshot } from './ontap-client';

export const NETAPP_SAMPLE_KINDS = ['CLUSTER', 'AGGREGATE', 'VOLUME'] as const;
export type NetAppSampleKindValue = (typeof NETAPP_SAMPLE_KINDS)[number];
export const CLUSTER_OBJECT_KEY = 'cluster';
const DAY = 86_400_000;

/** Days of NetApp capacity history kept. NETAPP_HISTORY_RETENTION_DAYS overrides the 400-day default, bounded to 30–3650. */
export function historyRetentionDays(raw = process.env.NETAPP_HISTORY_RETENTION_DAYS) {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return 400;
  return Math.min(Math.max(Math.trunc(value), 30), 3650);
}

const big = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? BigInt(Math.round(value)) : null;

/** One history row for the cluster total and one per aggregate and volume of a snapshot. */
export function capacitySamples(integrationId: string, snapshot: OntapSnapshot) {
  const observedAt = Number.isFinite(Date.parse(snapshot.observedAt)) ? new Date(snapshot.observedAt) : new Date();
  const keyOf = (item: { uuid?: string; name: string }) => item.uuid || item.name;
  return [
    { integrationId, kind: 'CLUSTER' as const, objectKey: CLUSTER_OBJECT_KEY, name: snapshot.systems[0]?.name ?? 'ONTAP', svm: null, state: snapshot.health, sizeBytes: big(snapshot.capacity.sizeBytes), usedBytes: big(snapshot.capacity.usedBytes), observedAt },
    ...snapshot.aggregates.map((item) => ({ integrationId, kind: 'AGGREGATE' as const, objectKey: keyOf(item), name: item.name, svm: null, state: item.state ?? null, sizeBytes: big(item.sizeBytes), usedBytes: big(item.usedBytes), observedAt })),
    ...snapshot.volumes.map((item) => ({ integrationId, kind: 'VOLUME' as const, objectKey: keyOf(item), name: item.name, svm: item.svm ?? null, state: item.state ?? null, sizeBytes: big(item.sizeBytes), usedBytes: big(item.usedBytes), observedAt })),
  ];
}

export type DailySample = { day: Date; observedAt: Date; name: string; svm: string | null; state: string | null; sizeBytes: bigint | number | null; usedBytes: bigint | number | null };
const num = (value: bigint | number | null) => value === null || value === undefined ? null : Number(value);
const percent = (used: number | null, size: number | null) => used !== null && size ? Math.round((used / size) * 10_000) / 100 : null;

/**
 * Trend from one sample per day (the last one of each UTC day), oldest first.
 * growthBytesPerDay is a least-squares slope of usedBytes over time; projectedFullAt is when
 * usedBytes would reach the latest size at that rate (only when growing and at least two days apart).
 */
export function buildTrend(rows: DailySample[]) {
  const points = rows.map((row) => {
    const sizeBytes = num(row.sizeBytes); const usedBytes = num(row.usedBytes);
    return { date: row.day.toISOString().slice(0, 10), observedAt: row.observedAt.toISOString(), sizeBytes, usedBytes, usedPercent: percent(usedBytes, sizeBytes), state: row.state };
  });
  const measured = points.filter((point) => point.usedBytes !== null);
  const first = measured[0]; const last = measured[measured.length - 1];
  let growthBytesPerDay: number | null = null;
  if (measured.length >= 2 && Date.parse(last.observedAt) - Date.parse(first.observedAt) >= DAY) {
    const origin = Date.parse(first.observedAt);
    const xs = measured.map((point) => (Date.parse(point.observedAt) - origin) / DAY); const ys = measured.map((point) => point.usedBytes as number);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
    growthBytesPerDay = den > 0 ? Math.round(xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / den) : null;
  }
  const latest = points[points.length - 1];
  const headroom = latest && latest.sizeBytes !== null && latest.usedBytes !== null ? latest.sizeBytes - latest.usedBytes : null;
  const daysToFull = growthBytesPerDay && growthBytesPerDay > 0 && headroom !== null ? Math.max(0, headroom / growthBytesPerDay) : null;
  return {
    points,
    summary: {
      days: points.length,
      firstUsedBytes: first?.usedBytes ?? null,
      lastUsedBytes: last?.usedBytes ?? null,
      changeBytes: first && last ? (last.usedBytes as number) - (first.usedBytes as number) : null,
      growthBytesPerDay,
      latestUsedPercent: latest?.usedPercent ?? null,
      projectedFullAt: daysToFull !== null && latest ? new Date(Date.parse(latest.observedAt) + daysToFull * DAY).toISOString() : null,
    },
  };
}
