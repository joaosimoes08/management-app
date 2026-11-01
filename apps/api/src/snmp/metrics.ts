type MetricSample = {
  observedAt: Date;
  ifIndex: number;
  name?: string | null;
  description?: string | null;
  adminUp?: boolean | null;
  operUp?: boolean | null;
  speedMbps?: number | null;
  counters: unknown;
};

type CounterValue = { value: bigint; bits: 32 | 64 } | null;

function counter(counters: unknown, key: string, bits: 32 | 64): CounterValue {
  if (!counters || typeof counters !== 'object') return null;
  const values = counters as Record<string, unknown>;
  const raw = values[key];
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'bigint') return null;
  try { const value = BigInt(raw); return value >= 0n ? { value, bits } : null; }
  catch { return null; }
}

function counterPair(previous: unknown, current: unknown, high: string, low: string) {
  const previousHigh = counter(previous, high, 64); const currentHigh = counter(current, high, 64);
  if (previousHigh && currentHigh) return [previousHigh, currentHigh] as const;
  return [counter(previous, low, 32), counter(current, low, 32)] as const;
}

function megabitsPerSecond(previous: CounterValue, current: CounterValue, elapsedSeconds: number): number | null {
  if (!previous || !current || elapsedSeconds <= 0) return null;
  let delta = current.value - previous.value;
  if (delta < 0n) {
    if (previous.bits !== 32 || current.bits !== 32) return null;
    delta += 1n << 32n;
  }
  const rate = Number(delta) * 8 / elapsedSeconds / 1_000_000;
  return Number.isFinite(rate) ? Math.round(rate * 1_000_000) / 1_000_000 : null;
}

export function interfaceTrafficRates(samples: MetricSample[]) {
  return samples.map((sample, index) => {
    const previous = samples[index - 1];
    const elapsedSeconds = previous ? (sample.observedAt.getTime() - previous.observedAt.getTime()) / 1000 : 0;
    const previousCounters = previous?.counters as Record<string, unknown> | undefined;
    const currentCounters = sample.counters as Record<string, unknown> | undefined;
    return {
      observedAt: sample.observedAt,
      ifIndex: sample.ifIndex,
      name: sample.name,
      description: sample.description,
      adminUp: sample.adminUp,
      operUp: sample.operUp,
      speedMbps: sample.speedMbps,
      inMbps: previous ? megabitsPerSecond(...counterPair(previousCounters, currentCounters, 'hcInOctets', 'inOctets'), elapsedSeconds) : null,
      outMbps: previous ? megabitsPerSecond(...counterPair(previousCounters, currentCounters, 'hcOutOctets', 'outOctets'), elapsedSeconds) : null,
    };
  });
}
