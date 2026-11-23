/**
 * Discovery P0: scan load limits.
 *
 * Before this, one scan could open (batch 32 hosts) × (up to 64 ports) sockets at once, and the worker runs two scans
 * in parallel. Every probe (one ping process or one TCP connect) now passes three gates, in this order:
 * 1. the subnet's socket cap (`maxSockets`): one limiter per subnet per process, shared by every scan of that subnet
 *    (a retried or re-delivered job running next to the original one counts against the same cap);
 * 2. the subnet's rate (`probesPerSecond`): start slots spaced evenly, no bursts at second boundaries;
 * 3. the process-wide socket ceiling (`DISCOVERY_PROCESS_MAX_SOCKETS`), shared by all subnets, so two concurrent scans
 *    of different subnets cannot add up past it.
 *
 * Ordering notes (review of #148):
 * - A probe takes its subnet slot before it waits for its rate slot, so while it waits it holds a subnet slot without
 *   an open socket. That is deliberate: taking the rate slot first would let probes collect rate slots while the
 *   sockets are busy and then start together when sockets free up, which breaks the rate. The cost is that at a low
 *   rate the subnet cap counts waiting probes too; it never lets more sockets open than the cap.
 * - The process-wide slot is taken last, so a slow subnet waiting on its rate never holds process-wide slots that
 *   other subnets could use. Under process-wide contention a probe can start later than its rate slot, never earlier.
 *
 * Every wait takes an AbortSignal: a cancelled scan or one past its deadline stops its queued probes at once
 * (`ProbeAbortedError`) instead of waiting for the batch to drain.
 *
 * Subnet values: null falls back to the defaults below (overridable by environment variables).
 */
export const DISCOVERY_MIN_PROBES_PER_SECOND = 1;
export const DISCOVERY_MAX_PROBES_PER_SECOND = 2000;
export const DISCOVERY_MIN_SOCKETS = 1;
export const DISCOVERY_MAX_SOCKETS = 1024;
export const DISCOVERY_DEFAULT_PROBES_PER_SECOND = boundedInt(process.env.DISCOVERY_DEFAULT_PROBES_PER_SECOND, 100, DISCOVERY_MIN_PROBES_PER_SECOND, DISCOVERY_MAX_PROBES_PER_SECOND);
export const DISCOVERY_DEFAULT_MAX_SOCKETS = boundedInt(process.env.DISCOVERY_DEFAULT_MAX_SOCKETS, 64, DISCOVERY_MIN_SOCKETS, DISCOVERY_MAX_SOCKETS);
/** Process-wide ceiling; the default fits two concurrent scans at the default subnet cap. */
export const DISCOVERY_DEFAULT_PROCESS_MAX_SOCKETS = boundedInt(process.env.DISCOVERY_PROCESS_MAX_SOCKETS, 128, 1, 4096);

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

/** Thrown to a queued probe when its scan was cancelled or ran past its deadline before the probe started. */
export class ProbeAbortedError extends Error {
  constructor() { super('Discovery probe aborted before it started'); this.name = 'ProbeAbortedError'; }
}

export type LimiterClock = { now: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void> };
const realClock: LimiterClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new ProbeAbortedError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(new ProbeAbortedError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  }),
};

/** Counting semaphore whose waiters can be aborted; capacity can change while in use. */
export class Semaphore {
  private active = 0;
  private peak = 0;
  private readonly waiting: Array<{ grant: () => void }> = [];

  constructor(private capacity: number) {}

  get inUse() { return this.active; }
  get peakInUse() { return this.peak; }
  get limit() { return this.capacity; }

  setCapacity(capacity: number) { this.capacity = capacity; this.drain(); }
  resetPeak() { this.peak = this.active; }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new ProbeAbortedError());
    if (this.active < this.capacity && !this.waiting.length) { this.take(); return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const entry = { grant: () => { signal?.removeEventListener('abort', onAbort); this.take(); resolve(); } };
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new ProbeAbortedError());
      };
      this.waiting.push(entry);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  release() { this.active -= 1; this.drain(); }

  private take() { this.active += 1; this.peak = Math.max(this.peak, this.active); }
  private drain() { while (this.active < this.capacity && this.waiting.length) this.waiting.shift()!.grant(); }
}

/** Process-wide socket ceiling shared by every subnet. */
export const discoveryProcessSockets = new Semaphore(DISCOVERY_DEFAULT_PROCESS_MAX_SOCKETS);

export type ProbeRunner = { run<T>(probe: () => Promise<T>): Promise<T> };

export class ProbeLimiter {
  private readonly sockets: Semaphore;
  private nextStartAt = 0;
  private spacingMs: number;
  private rateWaiters = 0;
  private lastStartAt = -Infinity;

  constructor(private limitsValue: DiscoveryLoadLimits, private clock: LimiterClock = realClock, private readonly processSockets: Semaphore | null = null) {
    this.sockets = new Semaphore(limitsValue.maxSockets);
    this.spacingMs = 1000 / limitsValue.probesPerSecond;
  }

  get limits() { return this.limitsValue; }
  /** Highest number of this limiter's probes that held a socket slot together; used by tests and logs. */
  get peakInFlight() { return this.sockets.peakInUse; }

  /** Applies a subnet's current limits (and, in tests, a clock) to a shared limiter. */
  configure(limits: DiscoveryLoadLimits, clock?: LimiterClock) {
    this.limitsValue = limits;
    this.spacingMs = 1000 / limits.probesPerSecond;
    this.sockets.setCapacity(limits.maxSockets);
    const next = clock ?? realClock;
    if (next !== this.clock) { this.clock = next; this.nextStartAt = 0; this.lastStartAt = -Infinity; }
  }

  /** A runner bound to one scan's abort signal. */
  bind(signal?: AbortSignal): ProbeRunner { return { run: (probe) => this.run(probe, signal) }; }

  /** Runs one probe once its subnet slot, its rate slot and a process-wide slot are free (see the ordering notes). */
  async run<T>(probe: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.sockets.acquire(signal);
    try {
      await this.waitForRateSlot(signal);
      if (this.processSockets) await this.processSockets.acquire(signal);
      try {
        return await probe();
      } finally {
        this.processSockets?.release();
      }
    } finally {
      this.sockets.release();
    }
  }

  private async waitForRateSlot(signal?: AbortSignal) {
    if (signal?.aborted) throw new ProbeAbortedError();
    const now = this.clock.now();
    const startAt = Math.max(now, this.nextStartAt);
    this.nextStartAt = startAt + this.spacingMs;
    if (startAt <= now) { this.lastStartAt = startAt; return; }
    this.rateWaiters += 1;
    try {
      await this.clock.sleep(startAt - now, signal);
      if (signal?.aborted) throw new ProbeAbortedError();
      this.lastStartAt = startAt;
    } catch (error) {
      // Give back the slots of aborted probes once nobody else is waiting, so the next scan does not inherit the gap.
      if (this.rateWaiters === 1) this.nextStartAt = Math.min(this.nextStartAt, this.lastStartAt + this.spacingMs);
      throw error;
    } finally {
      this.rateWaiters -= 1;
    }
  }
}

/** One limiter per subnet in this process, shared by every scan of that subnet. */
const subnetLimiters = new Map<string, ProbeLimiter>();

export function subnetProbeLimiter(subnetId: string, limits: DiscoveryLoadLimits, clock?: LimiterClock): ProbeLimiter {
  let limiter = subnetLimiters.get(subnetId);
  if (!limiter) { limiter = new ProbeLimiter(limits, clock, discoveryProcessSockets); subnetLimiters.set(subnetId, limiter); }
  else limiter.configure(limits, clock);
  return limiter;
}
