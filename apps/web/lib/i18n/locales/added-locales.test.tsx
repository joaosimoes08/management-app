import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, loadLocaleTexts, translateSourceTextDom, translateMessage, useI18n } from '../i18n';
import { getFormatLocale } from '@/lib/format/date';
import { APP_LOCALES, LAZY_LOCALES, LOCALE_NATIVE_NAMES, isAppLocale, type LocaleBundle } from './catalog';
import { getLoadedLocaleBundle, loadLocaleBundle, translateWithBundle } from './loader';

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
  it('load on demand and expose messages, source texts and rules', async () => {
    for (const locale of LAZY_LOCALES) {
      const bundle = await loadLocaleBundle(locale);
      expect(getLoadedLocaleBundle(locale)).toBe(bundle);
      expect(bundle.messages['common.cancel']).toBeTruthy();
      expect(bundle.sourceText['Cidade']).toBeTruthy();
      expect(bundle.substitutions?.length).toBeGreaterThan(0);
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

  it('translates hard-coded Portuguese text with the language table, its rules, then English', async () => {
    await loadLocaleTexts('es-ES');
    const root = document.createElement('div');
    root.innerHTML = '<span>Cidade</span><span>TCP 22: aberta</span><span>Etiquetas · Core</span><input placeholder="País">';
    translateSourceTextDom('es-ES', root);
    const spans = root.querySelectorAll('span');
    expect(spans[0].textContent).toBe('Ciudad');
    expect(spans[1].textContent).toBe('TCP 22: abierto');
    // Spelled like the Portuguese source, but translated by a rule: no English fallback.
    expect(spans[2].textContent).toBe('Etiquetas · Core');
    expect(root.querySelector('input')?.getAttribute('placeholder')).toBe('País');

    // Switching language re-translates from the Portuguese source, not from the Spanish text.
    await loadLocaleTexts('de-DE');
    translateSourceTextDom('de-DE', root);
    expect(spans[0].textContent).toBe('Stadt');
    expect(spans[2].textContent).toBe('Tags · Core');
    expect(root.querySelector('input')?.getAttribute('placeholder')).toBe('Land');
    translateSourceTextDom('pt-PT', root);
    expect(spans[0].textContent).toBe('Cidade');
  });
});

describe('translateWithBundle', () => {
  const english = (text: string) => `EN(${text.trim()})`;
  const stub: LocaleBundle = {
    messages: {},
    sourceText: { Cidade: 'Ciudad', Igual: 'Igual' },
    substitutions: [[/^Abrir (\S+)$/g, 'Abrir $1'], [/^Porta (\d+)$/g, 'Puerto $1']],
  };

  it('uses the table, then rules, then English, keeping surrounding spaces', () => {
    expect(translateWithBundle(stub, ' Cidade ', english)).toBe(' Ciudad ');
    expect(translateWithBundle(stub, 'Porta 22', english)).toBe('Puerto 22');
    expect(translateWithBundle(stub, 'Só em inglês', english)).toBe('EN(Só em inglês)');
  });

  it('keeps a match that is spelled like the Portuguese source', () => {
    expect(translateWithBundle(stub, 'Igual', english)).toBe('Igual');
    expect(translateWithBundle(stub, 'Abrir R1', english)).toBe('Abrir R1');
    // Global patterns are reusable: the same rule matches on every call.
    expect(translateWithBundle(stub, 'Abrir R2', english)).toBe('Abrir R2');
  });

  it('keeps identical rule output in every added locale', async () => {
    const es = await loadLocaleBundle('es-ES');
    expect(translateWithBundle(es, 'Etiquetas · Core', english)).toBe('Etiquetas · Core');
    expect(translateWithBundle(es, 'Abrir R1', english)).toBe('Abrir R1');
    for (const locale of LAZY_LOCALES) {
      const bundle = await loadLocaleBundle(locale);
      for (const input of ['Etiquetas · Core', 'Abrir R1']) expect(translateWithBundle(bundle, input, english)).not.toMatch(/^EN\(/);
    }
  });

  it('translates it-IT port and interval validation fully into Italian', async () => {
    const it_ = await loadLocaleBundle('it-IT');
    expect(translateWithBundle(it_, 'Porta: indica um número inteiro entre 1 e 65535.', english))
      .toBe('Porta: inserisca un numero intero compreso tra 1 e 65535.');
    expect(translateWithBundle(it_, 'Intervalo (min): indica um número inteiro entre 5 e 1440.', english))
      .toBe('Intervallo (min): inserisca un numero intero compreso tra 5 e 1440.');
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
