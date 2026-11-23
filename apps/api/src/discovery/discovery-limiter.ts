/**
 * Discovery P0: per-subnet scan load limits.
 *
 * Before this, one scan could open (batch 32 hosts) × (up to 64 ports) sockets at once, and the worker runs two scans
 * in parallel. Every probe (one ping process or one TCP connect) now goes through a limiter owned by the scan:
 * - `maxSockets`: probes in flight at the same time (TCP sockets plus ping processes);
 * - `probesPerSecond`: probes started per second, spaced evenly (no bursts at second boundaries).
 * Values are set per subnet; null falls back to the defaults below (overridable by environment variables).
 */
export const DISCOVERY_MIN_PROBES_PER_SECOND = 1;
export const DISCOVERY_MAX_PROBES_PER_SECOND = 2000;
export const DISCOVERY_MIN_SOCKETS = 1;
export const DISCOVERY_MAX_SOCKETS = 1024;
export const DISCOVERY_DEFAULT_PROBES_PER_SECOND = boundedInt(process.env.DISCOVERY_DEFAULT_PROBES_PER_SECOND, 100, DISCOVERY_MIN_PROBES_PER_SECOND, DISCOVERY_MAX_PROBES_PER_SECOND);
export const DISCOVERY_DEFAULT_MAX_SOCKETS = boundedInt(process.env.DISCOVERY_DEFAULT_MAX_SOCKETS, 64, DISCOVERY_MIN_SOCKETS, DISCOVERY_MAX_SOCKETS);

export type DiscoveryLoadLimits = { probesPerSecond: number; maxSockets: number };

function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Effective limits for a subnet: its own values when valid, otherwise the defaults. */
export function resolveDiscoveryLimits(subnet: { discoveryProbesPerSecond?: number | null; discoveryMaxSockets?: number | null } | null | undefined): DiscoveryLoadLimits {
  const pick = (value: number | null | undefined, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  return {
    probesPerSecond: pick(subnet?.discoveryProbesPerSecond, DISCOVERY_DEFAULT_PROBES_PER_SECOND, DISCOVERY_MIN_PROBES_PER_SECOND, DISCOVERY_MAX_PROBES_PER_SECOND),
    maxSockets: pick(subnet?.discoveryMaxSockets, DISCOVERY_DEFAULT_MAX_SOCKETS, DISCOVERY_MIN_SOCKETS, DISCOVERY_MAX_SOCKETS),
  };
}

export type LimiterClock = { now: () => number; sleep: (ms: number) => Promise<void> };
const realClock: LimiterClock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export class ProbeLimiter {
  private active = 0;
  private peak = 0;
  private readonly waiting: Array<() => void> = [];
  private nextStartAt = 0;
  private readonly spacingMs: number;

  constructor(readonly limits: DiscoveryLoadLimits, private readonly clock: LimiterClock = realClock) {
    this.spacingMs = 1000 / limits.probesPerSecond;
  }

  /** Highest number of probes that were in flight together; used by tests and logs. */
  get peakInFlight() { return this.peak; }

  /** Runs one probe once a socket slot is free and its rate slot has come. */
  async run<T>(probe: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      const now = this.clock.now();
      const startAt = Math.max(now, this.nextStartAt);
      this.nextStartAt = startAt + this.spacingMs;
      if (startAt > now) await this.clock.sleep(startAt - now);
      return await probe();
    } finally {
      this.release();
    }
  }

  private acquire() {
    if (this.active < this.limits.maxSockets) { this.take(); return Promise.resolve(); }
    return new Promise<void>((resolve) => this.waiting.push(() => { this.take(); resolve(); }));
  }

  private take() { this.active += 1; this.peak = Math.max(this.peak, this.active); }

  private release() {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}
