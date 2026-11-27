import { afterEach, describe, expect, it } from 'vitest';
import { parsePowerThresholds, readPowerThresholds, writePowerThresholds } from './rack-power-summary';

const KEY = 'mgmt.rack-power-thresholds';
afterEach(() => localStorage.clear());

describe('stored rack power thresholds', () => {
  it('reads valid thresholds unchanged', () => {
    expect(parsePowerThresholds(JSON.stringify({ warningPercent: 70, criticalPercent: 95 }))).toEqual({ warningPercent: 70, criticalPercent: 95 });
    writePowerThresholds({ warningPercent: 1, criticalPercent: 200 });
    expect(readPowerThresholds()).toEqual({ warningPercent: 1, criticalPercent: 200 });
  });

  it('reads corrupt JSON, the wrong shape and a missing key as the API defaults', () => {
    expect(parsePowerThresholds('{not json')).toEqual({});
    expect(parsePowerThresholds('null')).toEqual({});
    expect(parsePowerThresholds(JSON.stringify([70, 95]))).toEqual({});
    expect(parsePowerThresholds(JSON.stringify({ warningPercent: '70', criticalPercent: 95 }))).toEqual({});
    expect(parsePowerThresholds(JSON.stringify({ warningPercent: 70 }))).toEqual({});
    expect(parsePowerThresholds(null)).toEqual({});
  });

  it('ignores stored percentages the form would not accept (outside 1–200)', () => {
    localStorage.setItem(KEY, JSON.stringify({ warningPercent: 0, criticalPercent: 95 }));
    expect(readPowerThresholds()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ warningPercent: 70, criticalPercent: 5000 }));
    expect(readPowerThresholds()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ warningPercent: -10, criticalPercent: 90 }));
    expect(readPowerThresholds()).toEqual({});
  });
});
