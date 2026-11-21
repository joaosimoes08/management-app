export const DAY_MS = 86_400_000;
export const HISTORY_DAYS = 90;
const FORECAST_DAYS = 365;

export type CapacityMeasurement = { sampledAt: Date; used: number; total: number };
export type CapacityEstimateStatus = 'INSUFFICIENT' | 'ALREADY_AT_THRESHOLD' | 'NO_GROWTH' | 'BEYOND_HORIZON' | 'PROJECTED';

export function utcDay(value: Date) {
  return Math.floor(value.getTime() / DAY_MS) * DAY_MS;
}

export function usableMeasurement(used: number | null, total: number | null): used is number {
  return used !== null && Number.isFinite(used) && used >= 0 && total !== null && Number.isFinite(total) && total > 0;
}

export function estimateCapacity(samples: CapacityMeasurement[], latest: CapacityMeasurement | null, threshold: number) {
  let trendPer30Days: number | null = null;
  let estimatedAt: string | null = null;
  const currentPercent = latest && usableMeasurement(latest.used, latest.total) ? latest.used / latest.total * 100 : null;
  let status: CapacityEstimateStatus = 'INSUFFICIENT';
  if (!latest || currentPercent === null) return { currentPercent, trendPer30Days, estimatedAt, status, sampleCount: 0 };

  const latestTime = latest.sampledAt.getTime();
  const byDay = new Map<number, CapacityMeasurement>();
  for (const sample of [...samples, latest]) {
    const time = sample.sampledAt.getTime();
    if (time > latestTime || time < latestTime - HISTORY_DAYS * DAY_MS || !usableMeasurement(sample.used, sample.total)) continue;
    const day = utcDay(sample.sampledAt);
    if (time >= (byDay.get(day)?.sampledAt.getTime() ?? -Infinity)) byDay.set(day, sample);
  }

  // Capacity changes restart the trend. Earlier data can describe a different allocation or wattage budget.
  const daily = [...byDay.values()].sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  let firstComparable = daily.length - 1;
  while (firstComparable > 0 && daily[firstComparable - 1].total === latest.total) firstComparable--;
  const points = daily.slice(firstComparable);
  const sampleCount = points.length;
  if (sampleCount >= 3) {
    const origin = points[0].sampledAt.getTime();
    const times = points.map((point) => (point.sampledAt.getTime() - origin) / DAY_MS);
    const meanTime = times.reduce((sum, time) => sum + time, 0) / sampleCount;
    const meanUsed = points.reduce((sum, point) => sum + point.used, 0) / sampleCount;
    const variance = times.reduce((sum, time) => sum + (time - meanTime) ** 2, 0);
    const slope = points.reduce((sum, point, index) => sum + (times[index] - meanTime) * (point.used - meanUsed), 0) / variance;

    trendPer30Days = slope / latest.total * 3000;
    if (currentPercent >= threshold) {
      status = 'ALREADY_AT_THRESHOLD';
    } else if (slope <= 0) {
      status = 'NO_GROWTH';
    } else {
      const days = (latest.total * threshold / 100 - latest.used) / slope;
      status = days > FORECAST_DAYS ? 'BEYOND_HORIZON' : 'PROJECTED';
      if (status === 'PROJECTED') estimatedAt = new Date(latestTime + days * DAY_MS).toISOString();
    }
  }
  return { currentPercent, trendPer30Days, estimatedAt, status, sampleCount };
}
