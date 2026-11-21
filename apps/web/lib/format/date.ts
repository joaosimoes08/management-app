/**
 * Shared date and number formatting that follows the app's language setting
 * (Definições → Idioma). I18nProvider keeps the active locale in sync, so
 * callers no longer hard-code 'pt-PT'. Pass `timeZone` to format in a Site or
 * organisation zone; without it the browser's zone is used, as before.
 */
export type FormatLocale = 'pt-PT' | 'en-US';
export type DateInput = string | number | Date;
export interface DateFormatOptions extends Intl.DateTimeFormatOptions { locale?: FormatLocale }
export interface NumberFormatOptions extends Intl.NumberFormatOptions { locale?: FormatLocale }

let activeLocale: FormatLocale = 'pt-PT';

/** Called by I18nProvider whenever the language changes. */
export function setFormatLocale(locale: FormatLocale) { activeLocale = locale; }
export function getFormatLocale(): FormatLocale { return activeLocale; }

const toDate = (value: DateInput) => value instanceof Date ? value : new Date(value);

/** Date and time; same output as `new Date(v).toLocaleString(locale, options)`. */
export function formatDateTime(value: DateInput, { locale = activeLocale, ...options }: DateFormatOptions = {}): string {
  return toDate(value).toLocaleString(locale, options);
}

/** Date only; same output as `new Date(v).toLocaleDateString(locale, options)`. */
export function formatDate(value: DateInput, { locale = activeLocale, ...options }: DateFormatOptions = {}): string {
  return toDate(value).toLocaleDateString(locale, options);
}

/** Numbers; same output as `new Intl.NumberFormat(locale, options).format(v)`. */
export function formatNumber(value: number, { locale = activeLocale, ...options }: NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
