import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackTimeZones, listTimeZones } from './time-zones';

afterEach(() => vi.restoreAllMocks());

describe('listTimeZones', () => {
  it('returns the full IANA list from the browser, sorted, with UTC', () => {
    const zones = listTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain('Europe/Lisbon');
    expect(zones).toContain('America/New_York');
    expect(zones).toContain('UTC');
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });

  it('falls back to the four known zones when Intl.supportedValuesOf is missing, keeping the saved value', () => {
    const intl = Intl as unknown as { supportedValuesOf?: unknown };
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = undefined;
    try {
      expect(listTimeZones()).toEqual([...fallbackTimeZones].sort((a, b) => a.localeCompare(b)));
      expect(listTimeZones('Atlantic/Azores')).toContain('Atlantic/Azores');
    } finally {
      intl.supportedValuesOf = original;
    }
  });
});
