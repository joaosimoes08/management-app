import { getFormatLocale } from '@/lib/format/date';
import { translateMessage } from '@/lib/i18n/i18n';
import { localizeServerText } from '@/lib/i18n/server-text';

/**
 * t() for IPAM helpers that run outside React (labels, messages): the active app language, which
 * I18nProvider keeps in sync, or Portuguese before it mounts. Components use useUiText() instead.
 */
export function ipamText(key: string, params?: Record<string, string | number>) {
  return translateMessage(getFormatLocale(), key, undefined, params);
}

/** A text the API sends in Portuguese (planning labels, RIPE reasons), in the active app language. */
export function ipamServerText(text: string | null | undefined) {
  return localizeServerText((key, fallback, params) => translateMessage(getFormatLocale(), key, fallback, params), text);
}
