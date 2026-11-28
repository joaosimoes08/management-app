import type { LazyLocale } from '../locales/catalog';

/** One locale file of a domain: `messages/<domain>/<locale>.ts` exports `messages`. */
export type DomainLocaleModule = { messages: Record<string, string> };

/**
 * One domain's keyed messages. pt-PT and en-US are bundled with the app; the added languages are
 * literal import() calls, so each `<domain>/<locale>.ts` is its own chunk and downloads only when chosen.
 */
export type DomainMessages = {
  'pt-PT': Record<string, string>;
  'en-US': Record<string, string>;
  lazy: Record<LazyLocale, () => Promise<DomainLocaleModule>>;
};
