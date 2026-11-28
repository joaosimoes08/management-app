import type { AppLocale } from './i18n';
import { isLazyLocale } from './locales/catalog';
import { getLoadedLocaleBundle } from './locales/loader';
import { messages as englishServerMessages } from './messages/server/en-US';
import { messages as serverMessages, type ServerMessageKey } from './messages/server/pt-PT';

/** t() of the active language: the provider's t, useUiText(), or translateMessage bound to a locale. */
export type ServerTextTranslate = (key: string, fallback?: string, params?: Record<string, string | number>) => string;

type Pattern = { key: ServerMessageKey; regex: RegExp; params: string[] };

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The API's own Portuguese text → its key (exact matches).
const exact = new Map<string, ServerMessageKey>();
// Texts the API builds with values in them ("{name} não é observado…"): one anchored pattern each.
const patterns: Pattern[] = [];
for (const [key, template] of Object.entries(serverMessages) as [ServerMessageKey, string][]) {
  const params = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  if (!params.length) { exact.set(template, key); continue; }
  const source = template.split(/\{\w+\}/g).map(escapeRegex).join('(.+?)');
  patterns.push({ key, regex: new RegExp(`^${source}$`), params });
}

/**
 * Shows a text the API sends in Portuguese (error messages, alert and inventory titles, trap labels, …)
 * in the active language. Only an exact match of a known server text, or of one of its templates with the
 * values filled in, is translated; anything else, including surrounding whitespace, comes back unchanged.
 */
export function localizeServerText(t: ServerTextTranslate, text: string | null | undefined): string {
  if (!text) return text ?? '';
  const core = text.trim();
  const leading = text.slice(0, text.indexOf(core));
  const trailing = text.slice(leading.length + core.length);
  const key = exact.get(core);
  if (key) return `${leading}${t(key, core)}${trailing}`;
  for (const pattern of patterns) {
    const match = pattern.regex.exec(core);
    if (!match) continue;
    const params = Object.fromEntries(pattern.params.map((name, index) => [name, match[index + 1]]));
    return `${leading}${t(pattern.key, core, params)}${trailing}`;
  }
  return text;
}

/** A " · "-joined list of server texts (SNMP trap summaries): each part on its own. */
export function localizeServerTextList(t: ServerTextTranslate, text: string | null | undefined): string {
  if (!text) return text ?? '';
  return text.split(' · ').map((part) => localizeServerText(t, part)).join(' · ');
}

/**
 * localizeServerText for a fixed locale, outside React (the API client's error fallback). It reads only the
 * server tables: an added language uses its loaded file, else English, as the provider's t() does.
 */
export function localizeServerTextFor(locale: AppLocale, text: string | null | undefined): string {
  const own = (key: string) => {
    const table: Record<string, string> | undefined = isLazyLocale(locale) ? getLoadedLocaleBundle(locale)?.messages
      : locale === 'en-US' ? englishServerMessages : serverMessages;
    if (table && Object.hasOwn(table, key)) return table[key];
    return isLazyLocale(locale) && Object.hasOwn(englishServerMessages, key) ? englishServerMessages[key] : undefined;
  };
  const t: ServerTextTranslate = (key, fallback, params = {}) => (own(key) ?? fallback ?? key)
    .replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match);
  return localizeServerText(t, text);
}
