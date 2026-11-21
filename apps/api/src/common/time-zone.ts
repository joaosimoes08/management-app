import { ValidateBy, ValidationOptions } from 'class-validator';

import { IANA_ALIASES } from './time-zone-aliases';

/** Name shape only (casing is checked against ICU below); keeps out offsets like "+01:00", which Intl also accepts. */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)*$/;

/**
 * IANA zone names are case-sensitive in the database ("Europe/Lisbon"), but Intl resolves
 * them case-insensitively ("EUROPE/LISBON", "Europe/LISBON" and "europe/lisbon" all work).
 * Only the exact canonical spelling is accepted, so what we store always matches the names
 * the browser's own list offers: either ICU reports the value back unchanged, or it is a
 * known tzdata alias spelled exactly (e.g. "Asia/Kolkata", which ICU reports as "Asia/Calcutta").
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !IANA_SHAPE.test(value)) return false;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return false;
  }
  return resolved === value || IANA_ALIASES.has(value);
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return ValidateBy({
    name: 'isIanaTimeZone',
    validator: {
      validate: (value) => isIanaTimeZone(value),
      defaultMessage: () => '$property must be a valid IANA time zone (e.g. Europe/Lisbon, America/New_York, UTC)',
    },
  }, options);
}
