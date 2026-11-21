/** Zones offered when the browser cannot list IANA time zones (Intl.supportedValuesOf is missing). */
export const fallbackTimeZones = ['Europe/Lisbon', 'UTC', 'Europe/London', 'Europe/Madrid'] as const;

type IntlWithSupportedValues = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };

/** Full IANA time-zone list from the browser, with UTC always present and a saved value kept. */
export function listTimeZones(current?: string | null): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as IntlWithSupportedValues).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  const set = new Set<string>(zones.length ? zones : fallbackTimeZones);
  set.add('UTC');
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}
