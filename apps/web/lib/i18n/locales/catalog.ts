import type { AppLocale } from '../i18n';

/** Every language the app offers, in picker order. Keep in step with apps/api/src/common/locales.ts. */
export const APP_LOCALES = ['pt-PT', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT'] as const satisfies readonly AppLocale[];

/** Languages whose texts live in ./<locale>.ts and load only when chosen. */
export type LazyLocale = Exclude<AppLocale, 'pt-PT' | 'en-US'>;
export const LAZY_LOCALES = ['es-ES', 'fr-FR', 'de-DE', 'it-IT'] as const satisfies readonly LazyLocale[];

/** Each language named in itself, as language pickers show it. */
export const LOCALE_NATIVE_NAMES: Record<AppLocale, string> = {
  'pt-PT': 'Português (Portugal)',
  'en-US': 'English (United States)',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
  'it-IT': 'Italiano',
};

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}

export function isLazyLocale(value: unknown): value is LazyLocale {
  return typeof value === 'string' && (LAZY_LOCALES as readonly string[]).includes(value);
}

/**
 * One language's texts. Missing entries fall back to English, never to Portuguese.
 * - messages: keyed messages, same keys as the en-US block in i18n.tsx.
 * - sourceText: hard-coded Portuguese UI text (the source) → this language, same keys as enUS in source-text-messages.ts.
 * - substitutions: rules for Portuguese text with variable parts, applied when no sourceText entry matches.
 */
export type LocaleBundle = {
  messages: Record<string, string>;
  sourceText: Record<string, string>;
  substitutions?: Array<[RegExp, string]>;
};
