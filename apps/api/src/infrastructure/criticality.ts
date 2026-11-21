export const CRITICALITY_TIERS = ['T1', 'T2', 'T3'] as const;
export type CriticalityTierValue = (typeof CRITICALITY_TIERS)[number];

export type CriticalityInput = { isCritical?: boolean; criticalityTier?: CriticalityTierValue | null };
export type CriticalityState = { criticalityTier: CriticalityTierValue | null; criticalityTierReviewed: boolean };

/**
 * Values to write for a device's criticality. criticalityTier is the source of truth; isCritical is kept in sync
 * (true exactly when a tier is set). Returns {} when the request does not touch criticality.
 * - A tier in the request sets it and marks it reviewed.
 * - A legacy isCritical=true keeps an existing tier (or sets T1, unreviewed for a new device).
 * - A legacy isCritical=false clears the tier.
 */
export function criticalityWrite(input: CriticalityInput, current?: CriticalityState): Partial<{ isCritical: boolean } & CriticalityState> {
  if (input.criticalityTier !== undefined) {
    const tier = input.criticalityTier;
    return { criticalityTier: tier, isCritical: tier !== null, criticalityTierReviewed: true };
  }
  if (input.isCritical === undefined) return {};
  if (!input.isCritical) return { isCritical: false, criticalityTier: null, criticalityTierReviewed: false };
  if (current?.criticalityTier) return { isCritical: true };
  return { isCritical: true, criticalityTier: 'T1', criticalityTierReviewed: false };
}

export function isCriticalityTier(value: unknown): value is CriticalityTierValue {
  return typeof value === 'string' && (CRITICALITY_TIERS as readonly string[]).includes(value);
}
