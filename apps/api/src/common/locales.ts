/**
 * Languages the organization can choose. The value is stored as plain text in
 * SystemSettings.locale, so adding one needs no migration. Keep in step with
 * apps/web/lib/i18n/locales/catalog.ts.
 */
export const SUPPORTED_LOCALES = ['pt-PT', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
