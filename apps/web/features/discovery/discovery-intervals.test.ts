import { describe, expect, it } from 'vitest';
import { DISCOVERY_INTERVAL_MAX_HOURS, DISCOVERY_INTERVAL_MIN_HOURS, discoveryIntervalChoices, discoveryIntervalOptions, formatDiscoveryInterval } from './discovery-intervals';
import { translateMessage } from '@/lib/i18n/i18n';
const pt = (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage('pt-PT', key, fallback, params);
const en = (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage('en-US', key, fallback, params);

describe('discovery intervals', () => {
  it('stays inside the 1–168 h range the API accepts', () => {
    expect(Math.min(...discoveryIntervalOptions)).toBe(DISCOVERY_INTERVAL_MIN_HOURS);
    expect(Math.max(...discoveryIntervalOptions)).toBe(DISCOVERY_INTERVAL_MAX_HOURS);
    expect(discoveryIntervalOptions.every((hours) => Number.isInteger(hours))).toBe(true);
  });

  it('keeps a saved valid value that is not in the list and ignores invalid ones', () => {
    expect(discoveryIntervalChoices(36)).toEqual([1, 2, 4, 6, 8, 12, 24, 36, 48, 72, 168]);
    expect(discoveryIntervalChoices(12)).toEqual([...discoveryIntervalOptions]);
    expect(discoveryIntervalChoices(200)).toEqual([...discoveryIntervalOptions]);
  });

  it('labels hours and whole days, in Portuguese and English', () => {
    expect(formatDiscoveryInterval(pt, 6)).toBe('6 h');
    expect(formatDiscoveryInterval(pt, 36)).toBe('36 h');
    expect(formatDiscoveryInterval(pt, 24)).toBe('1 dia');
    expect(formatDiscoveryInterval(pt, 168)).toBe('7 dias');
    expect(formatDiscoveryInterval(en, 24)).toBe('1 day');
    expect(formatDiscoveryInterval(en, 168)).toBe('7 days');
  });
});
