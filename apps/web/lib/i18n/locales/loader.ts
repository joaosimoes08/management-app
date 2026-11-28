import { loadDomainMessages } from '../messages/registry';
import type { LazyLocale, LocaleBundle } from './catalog';

/**
 * Literal import() per language, so each file is its own chunk and only the chosen one downloads.
 */
const importers: Record<LazyLocale, () => Promise<LocaleBundle>> = {
  'es-ES': () => import('./es-ES'),
  'fr-FR': () => import('./fr-FR'),
  'de-DE': () => import('./de-DE'),
  'it-IT': () => import('./it-IT'),
};

const loaded = new Map<LazyLocale, LocaleBundle>();
const pending = new Map<LazyLocale, Promise<LocaleBundle>>();
// Languages loaded with at least one domain file missing: their bundle is used, and the next request retries.
const partial = new Set<LazyLocale>();

export function getLoadedLocaleBundle(locale: LazyLocale): LocaleBundle | undefined {
  return loaded.get(locale);
}

/** True until the language's file and every domain file have loaded, so a partial load is retried. */
export function needsLocaleBundle(locale: LazyLocale): boolean {
  return !loaded.has(locale) || partial.has(locale);
}

export function loadLocaleBundle(locale: LazyLocale): Promise<LocaleBundle> {
  const ready = loaded.get(locale);
  if (ready && !partial.has(locale)) return Promise.resolve(ready);
  let load = pending.get(locale);
  if (!load) {
    // The language's own file plus its file of every domain in ../messages, downloaded in parallel.
    // A failed domain file is left out (its keys show in English); only the language's own file failing rejects.
    load = Promise.all([importers[locale](), loadDomainMessages(locale)]).then(([module, domains]) => {
      const bundle: LocaleBundle = { messages: { ...module.messages, ...domains.messages }, sourceText: module.sourceText, substitutions: module.substitutions };
      loaded.set(locale, bundle);
      if (domains.failed.length) partial.add(locale);
      else partial.delete(locale);
      pending.delete(locale);
      return bundle;
    }).catch((error: unknown) => {
      // Cleared so the next request retries; until then the whole language shows in English.
      pending.delete(locale);
      console.warn(`i18n: the ${locale} language file failed to load; showing English.`, error);
      throw error;
    });
    pending.set(locale, load);
  }
  return load;
}

/**
 * Translates hard-coded Portuguese text with one language's table and rules. When no entry or rule matches,
 * the English translation is used (English is the fallback for every added language).
 */
export function translateWithBundle(bundle: LocaleBundle, input: string, english: (input: string) => string): string {
  const core = input.trim();
  if (!core) return input;
  const leading = input.match(/^\s*/)?.[0] ?? '';
  const trailing = input.match(/\s*$/)?.[0] ?? '';
  // Own entries only: inherited members ("constructor", "toString", "__proto__") are not translations.
  const direct = Object.hasOwn(bundle.sourceText, core) ? bundle.sourceText[core] : undefined;
  if (direct !== undefined) return `${leading}${direct}${trailing}`;
  // Track whether a rule matched, not whether the text changed: a translation can be spelled like the
  // Portuguese source (es-ES "Etiquetas · Core", "Abrir R1") and must not fall back to English.
  let translated = core;
  let matched = false;
  for (const [pattern, replacement] of bundle.substitutions ?? []) {
    // search() ignores and restores lastIndex, so global patterns are safe to test here.
    if (translated.search(pattern) === -1) continue;
    matched = true;
    translated = translated.replace(pattern, replacement);
  }
  if (matched) return `${leading}${translated}${trailing}`;
  return english(input);
}
