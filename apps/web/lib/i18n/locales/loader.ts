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
      const bundle: LocaleBundle = { messages: { ...module.messages, ...domains.messages } };
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
