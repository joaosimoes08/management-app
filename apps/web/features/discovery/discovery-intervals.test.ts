import { describe, expect, it } from 'vitest';
import { DISCOVERY_INTERVAL_MAX_HOURS, DISCOVERY_INTERVAL_MIN_HOURS, discoveryIntervalChoices, discoveryIntervalOptions, formatDiscoveryInterval } from './discovery-intervals';
import { translateSourceText } from '@/lib/i18n/source-text-messages';

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
    expect(formatDiscoveryInterval(6)).toBe('6 h');
    expect(formatDiscoveryInterval(36)).toBe('36 h');
    expect(formatDiscoveryInterval(24)).toBe('1 dia');
    expect(formatDiscoveryInterval(168)).toBe('7 dias');
    expect(translateSourceText('en-US', '1 dia')).toBe('1 day');
    expect(translateSourceText('en-US', '7 dias')).toBe('7 days');
  });
});
