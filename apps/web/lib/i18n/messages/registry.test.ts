import { describe, expect, it } from 'vitest';
import { LAZY_LOCALES } from '../locales/catalog';
import { loadLocaleBundle } from '../locales/loader';
import { translateMessage } from '../i18n';
import * as domains from './domains';
import { domainMessages, loadDomainMessages } from './registry';

describe('per-domain message registry', () => {
  it('bundles pt-PT and en-US of every registered domain', () => {
    for (const domain of Object.values(domains)) {
      expect(Object.keys(domain['en-US']).sort()).toEqual(Object.keys(domain['pt-PT']).sort());
      for (const key of Object.keys(domain['pt-PT'])) {
        expect(domainMessages['pt-PT'][key]).toBe(domain['pt-PT'][key]);
        expect(translateMessage('pt-PT', key)).toBe(domain['pt-PT'][key]);
        expect(translateMessage('en-US', key)).toBe(domain['en-US'][key]);
      }
    }
  });

  it('loads each added language of every domain on demand, into that language\'s bundle', async () => {
    for (const locale of LAZY_LOCALES) {
      const loaded = await loadDomainMessages(locale);
      const bundle = await loadLocaleBundle(locale);
      for (const domain of Object.values(domains)) {
        for (const key of Object.keys(domain['pt-PT'])) {
          expect(loaded[key], `${locale} ${key}`).toBeTruthy();
          expect(bundle.messages[key]).toBe(loaded[key]);
          expect(translateMessage(locale, key, undefined, { name: 'x', uses: 1 })).not.toBe(key);
        }
      }
    }
  });
});
