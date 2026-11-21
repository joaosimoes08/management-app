import type { PowerDefaults } from '../power';

/** Test stand-in for `GET /api/v1/power/defaults` (tests only; the app reads the API). */
export const TEST_POWER_DEFAULTS: PowerDefaults = {
  pduOutletCount: 32,
  pduBudgetWatts: 3680,
  maxPduOutletCount: 96,
  powerPlugCount: 2,
  minPowerPlugCount: 0,
  maxPowerPlugCount: 8,
  maxWatts: 100000,
  wattsByDeviceType: { SWITCH: 150, SERVER: 350, PATCH_PANEL: 0 },
  wattsFallback: 100,
  warningRatio: 0.8,
  criticalRatio: 1,
};
