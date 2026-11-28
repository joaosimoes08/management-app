import type { LazyLocale } from '../locales/catalog';
import * as domains from './domains';
import type { DomainMessages } from './types';

const registered: DomainMessages[] = Object.values(domains);

function merge(tables: Array<Record<string, string>>): Record<string, string> {
  return Object.assign({}, ...tables) as Record<string, string>;
}

/** The bundled keyed messages of every registered domain. */
export const domainMessages: Record<'pt-PT' | 'en-US', Record<string, string>> = {
  'pt-PT': merge(registered.map((domain) => domain['pt-PT'])),
  'en-US': merge(registered.map((domain) => domain['en-US'])),
};

/** Downloads one added language's file of every registered domain, merged into one table. */
export function loadDomainMessages(locale: LazyLocale): Promise<Record<string, string>> {
  return Promise.all(registered.map((domain) => domain.lazy[locale]())).then((modules) => merge(modules.map((module) => module.messages)));
}
