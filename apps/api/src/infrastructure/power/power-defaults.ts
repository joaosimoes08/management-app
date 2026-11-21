/**
 * Rack power defaults — the ONE place to change PDU and wattage defaults.
 *
 * Every value here is an estimate used when nothing more specific is stored:
 *   - Per-device watts resolve in this order:
 *       1. Device.estimatedWatts          (source "manual")
 *       2. DeviceModel.typicalWatts       (source "modelo")
 *       3. DEFAULT_WATTS_BY_DEVICE_TYPE   (source "padrão")
 *   - Per-device plug count resolves Device.powerPlugCount → DeviceModel.powerPlugCount → DEFAULT_POWER_PLUG_COUNT.
 *   - New PDUs get DEFAULT_PDU_OUTLET_COUNT outlets and DEFAULT_PDU_BUDGET_WATTS. Both can be changed per PDU
 *     through PUT /api/v1/racks/:id/pdus, so editing them here only affects PDUs created afterwards.
 *
 * Note: the migration 20261120200000_rack_pdu_power backfilled existing racks with 32 outlets / 3680 W literally;
 * changing these constants does not rewrite PDUs that already exist.
 *
 * Changing a value: edit it here, restart the API. No migration is needed.
 */

/** Outlets on a newly created PDU (the default vertical 32-outlet strip). */
export const DEFAULT_PDU_OUTLET_COUNT = 32;

/** Power budget of a newly created PDU, in watts. 3680 W = 16 A × 230 V single-phase feed. */
export const DEFAULT_PDU_BUDGET_WATTS = 3680;

/** Upper bound accepted for a PDU's outlet count through the API. */
export const MAX_PDU_OUTLET_COUNT = 96;

/** Plugs (PSU cords) assumed for a device when neither the device nor its model says otherwise. */
export const DEFAULT_POWER_PLUG_COUNT = 2;

/** Accepted range for a device or model plug count. 0 = no power (patch panel, blanking plate). */
export const MIN_POWER_PLUG_COUNT = 0;
export const MAX_POWER_PLUG_COUNT = 8;

/** Upper bound accepted for any watt value (device estimate, model typical/max, PDU budget). */
export const MAX_WATTS = 100_000;

/**
 * Estimated draw in watts by Device.type when neither the device nor its model has a value.
 * Keys are Device.type values. Unknown types fall back to DEFAULT_WATTS_FALLBACK.
 */
export const DEFAULT_WATTS_BY_DEVICE_TYPE: Readonly<Record<string, number>> = Object.freeze({
  SWITCH: 150,
  ROUTER: 200,
  FIREWALL: 200,
  SERVER: 350,
  STORAGE: 500,
  PATCH_PANEL: 0, // passive
  PASSIVE: 0, // passive (blanking plates, cable managers)
  OTHER: 100,
});

/** Watts used for any device type not listed in DEFAULT_WATTS_BY_DEVICE_TYPE. */
export const DEFAULT_WATTS_FALLBACK = 100;

/** Load thresholds (fraction of outlets or budget) used for the amber/red badges. Warnings never block saving. */
export const POWER_WARNING_RATIO = 0.8; // amber at >= 80%
export const POWER_CRITICAL_RATIO = 1.0; // red at > 100% of budget, or 100% of outlets used

/** Everything above in one object, served by GET /api/v1/power/defaults so the web app shows the same values. */
export function powerDefaults() {
  return {
    pduOutletCount: DEFAULT_PDU_OUTLET_COUNT,
    pduBudgetWatts: DEFAULT_PDU_BUDGET_WATTS,
    maxPduOutletCount: MAX_PDU_OUTLET_COUNT,
    powerPlugCount: DEFAULT_POWER_PLUG_COUNT,
    minPowerPlugCount: MIN_POWER_PLUG_COUNT,
    maxPowerPlugCount: MAX_POWER_PLUG_COUNT,
    maxWatts: MAX_WATTS,
    wattsByDeviceType: { ...DEFAULT_WATTS_BY_DEVICE_TYPE },
    wattsFallback: DEFAULT_WATTS_FALLBACK,
    warningRatio: POWER_WARNING_RATIO,
    criticalRatio: POWER_CRITICAL_RATIO,
  };
}
