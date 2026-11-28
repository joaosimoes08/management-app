import type { LazyLocale } from '../locales/catalog';
import * as domains from './domains';
import type { DomainMessages } from './types';

const registered: Array<[name: string, domain: DomainMessages]> = Object.entries(domains);

function merge(tables: Array<Record<string, string>>): Record<string, string> {
  return Object.assign({}, ...tables) as Record<string, string>;
}

/** The bundled keyed messages of every registered domain. */
export const domainMessages: Record<'pt-PT' | 'en-US', Record<string, string>> = {
  'pt-PT': merge(registered.map(([, domain]) => domain['pt-PT'])),
  'en-US': merge(registered.map(([, domain]) => domain['en-US'])),
};

/** One added language's keyed messages of every registered domain, and the domains whose file failed. */
export type LoadedDomainMessages = { messages: Record<string, string>; failed: string[] };

/**
 * Downloads one added language's file of every registered domain, merged into one table. Each domain
 * settles on its own: a file that fails to download is left out with a console.warn naming the domain
 * and locale, so that domain's keys show in English (the fallback) and every other domain still loads.
 */
export function loadDomainMessages(locale: LazyLocale): Promise<LoadedDomainMessages> {
  return Promise.allSettled(registered.map(([, domain]) => domain.lazy[locale]())).then((results) => {
    const failed: string[] = [];
    const tables = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value.messages];
      const name = registered[index][0];
      failed.push(name);
      console.warn(`i18n: the "${name}" messages for ${locale} failed to load; showing them in English.`, result.reason);
      return [];
    });
    return { messages: merge(tables), failed };
  });
}
