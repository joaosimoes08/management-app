import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translateMessage, useI18n } from '../i18n';
import { getFormatLocale } from '@/lib/format/date';
import { APP_LOCALES, LAZY_LOCALES, LOCALE_NATIVE_NAMES, isAppLocale } from './catalog';
import { getLoadedLocaleBundle, loadLocaleBundle } from './loader';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ setupStatus: null }) }));

beforeEach(() => { window.localStorage.clear(); });
afterEach(cleanup);

describe('locale catalog', () => {
  it('offers six languages, each named in itself', () => {
    expect(APP_LOCALES).toEqual(['pt-PT', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT']);
    expect(LAZY_LOCALES.map((locale) => LOCALE_NATIVE_NAMES[locale])).toEqual(['Español', 'Français', 'Deutsch', 'Italiano']);
    expect(isAppLocale('de-DE')).toBe(true);
    expect(isAppLocale('de')).toBe(false);
  });
});

describe('added locale files', () => {
  it('load on demand and expose their keyed messages', async () => {
    for (const locale of LAZY_LOCALES) {
      const bundle = await loadLocaleBundle(locale);
      expect(getLoadedLocaleBundle(locale)).toBe(bundle);
      expect(bundle.messages['common.cancel']).toBeTruthy();
      expect(Object.keys(bundle)).toEqual(['messages']);
    }
  });

  it('falls back to English, never Portuguese, for keyed messages', async () => {
    const bundle = await loadLocaleBundle('fr-FR');
    expect(translateMessage('fr-FR', 'common.cancel')).toBe('Annuler');
    // Remove one key from the loaded bundle so the test does not depend on fr-FR coverage.
    const saved = bundle.messages['common.previous'];
    delete bundle.messages['common.previous'];
    try {
      expect(translateMessage('fr-FR', 'common.previous')).toBe('Previous');
    } finally {
      if (saved !== undefined) bundle.messages['common.previous'] = saved;
    }
    expect(translateMessage('fr-FR', 'missing.key', 'Fallback')).toBe('Fallback');
  });

  it('uses the locale\'s own .other when its plural category (fr "many") has no entry', async () => {
    await loadLocaleBundle('fr-FR');
    expect(new Intl.PluralRules('fr-FR').select(1000000)).toBe('many');
    expect(translateMessage('fr-FR', 'infra.deviceCount', undefined, { count: 1000000 })).toBe('1000000 équipements');
    expect(translateMessage('fr-FR', 'infra.deviceCount', undefined, { count: 1 })).toBe('1 équipement');
    // A key the locale lacks entirely still falls back to English.
    const bundle = getLoadedLocaleBundle('fr-FR')!;
    const saved = { one: bundle.messages['infra.deviceCount.one'], other: bundle.messages['infra.deviceCount.other'] };
    delete bundle.messages['infra.deviceCount.one'];
    delete bundle.messages['infra.deviceCount.other'];
    try {
      expect(translateMessage('fr-FR', 'infra.deviceCount', undefined, { count: 1000000 })).toBe('1000000 devices');
    } finally {
      bundle.messages['infra.deviceCount.one'] = saved.one;
      bundle.messages['infra.deviceCount.other'] = saved.other;
    }
  });

  it('keeps pt-PT and en-US lookups as before', () => {
    expect(translateMessage('en-US', 'common.cancel')).toBe('Cancel');
    expect(translateMessage('pt-PT', 'common.cancel')).toBe('Cancelar');
  });

  it('leaves the text on the page alone: only keyed messages are translated', async () => {
    window.localStorage.setItem('civernode.locale', 'es-ES');
    await act(async () => { render(<I18nProvider><span data-testid="literal">Cidade</span><input data-testid="field" placeholder="País" /><Probe /></I18nProvider>); });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('es-ES:Cancelar'));
    expect(screen.getByTestId('literal').textContent).toBe('Cidade');
    expect(screen.getByTestId('field').getAttribute('placeholder')).toBe('País');
  });
});

function Probe() {
  const { t, locale } = useI18n();
  return <span data-testid="probe">{locale}:{t('common.cancel')}</span>;
}

describe('I18nProvider with an added locale', () => {
  it('follows the stored locale for <html lang>, formatting and keyed texts', async () => {
    window.localStorage.setItem('civernode.locale', 'it-IT');
    await act(async () => { render(<I18nProvider><Probe /></I18nProvider>); });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('it-IT:Annulla'));
    expect(document.documentElement.lang).toBe('it-IT');
    expect(getFormatLocale()).toBe('it-IT');
  });
});
