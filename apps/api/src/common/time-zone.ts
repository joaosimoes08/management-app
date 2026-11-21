import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * IANA zone names are case-sensitive in the database ("Europe/Lisbon"), but Intl also
 * accepts "europe/lisbon"; requiring each segment to start with a capital keeps what we
 * store matching the names the browser's own list offers.
 */
const IANA_NAME = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)*$/;

/** True for any IANA time zone the runtime's ICU knows, e.g. "America/New_York", "UTC", "Etc/GMT+5". */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !IANA_NAME.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
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
