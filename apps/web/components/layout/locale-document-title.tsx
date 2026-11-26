'use client';

import { useI18n } from '@/lib/i18n';

/**
 * The browser tab title follows the app locale. React 19 hoists this <title> into <head>.
 * app/layout.tsx deliberately has no static metadata title: Next.js re-applied that Portuguese
 * title after hydration and on navigation, overriding the locale.
 */
export function LocaleDocumentTitle() {
  const { t } = useI18n();
  return <title>{t('meta.title')}</title>;
}
