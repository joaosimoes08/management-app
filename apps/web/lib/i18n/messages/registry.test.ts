import { afterEach, describe, expect, it, vi } from 'vitest';
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
      const { messages: loaded, failed } = await loadDomainMessages(locale);
      expect(failed).toEqual([]);
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

describe('a domain file that fails to download', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('shows that domain in English, loads the rest of the language, warns, and retries on the next request', async () => {
    // Fresh modules, so the loader's cache is empty and no earlier test has loaded de-DE.
    vi.resetModules();
    const freshDomains = await import('./domains');
    const { loadLocaleBundle: load, needsLocaleBundle } = await import('../locales/loader');
    const { translateMessage: translate } = await import('../i18n');
    const { messages: germanTable } = await import('../locales/de-DE');
    const { messages: germanTags } = await import('./tags/de-DE');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const importer = vi.spyOn(freshDomains.tags.lazy, 'de-DE').mockRejectedValueOnce(new Error('chunk failed'));

    const bundle = await load('de-DE');
    // The language's own file still loaded...
    expect(bundle.messages['infra.rack.reorderRacks']).toBe(germanTable['infra.rack.reorderRacks']);
    expect(translate('de-DE', 'infra.rack.reorderRacks')).toBe('Racks neu anordnen');
    // ...and the failed domain's keys fall back to English.
    expect(bundle.messages['tags.manage']).toBeUndefined();
    expect(translate('de-DE', 'tags.manage')).toBe(freshDomains.tags['en-US']['tags.manage']);
    expect(translate('de-DE', 'tags.manage')).not.toBe(germanTags['tags.manage']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"tags" messages for de-DE failed to load'), expect.any(Error));

    // Partial loads are not final: the next request downloads the domain again.
    expect(needsLocaleBundle('de-DE')).toBe(true);
    const retried = await load('de-DE');
    expect(importer).toHaveBeenCalledTimes(2);
    expect(retried.messages['tags.manage']).toBe(germanTags['tags.manage']);
    expect(translate('de-DE', 'tags.manage')).toBe(germanTags['tags.manage']);
    expect(needsLocaleBundle('de-DE')).toBe(false);
  });

  it('clears the pending load when the language file itself fails, so a retry is possible', async () => {
    vi.resetModules();
    vi.doMock('../locales/it-IT', () => { throw new Error('chunk failed'); });
    const { loadLocaleBundle: load, needsLocaleBundle } = await import('../locales/loader');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(load('it-IT')).rejects.toThrow();
    vi.doUnmock('../locales/it-IT');
    expect(needsLocaleBundle('it-IT')).toBe(true);
    const bundle = await load('it-IT');
    expect(Object.keys(bundle.messages).length).toBeGreaterThan(0);
  });
});
