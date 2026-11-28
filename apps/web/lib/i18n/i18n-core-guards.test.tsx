import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleDocumentTitle } from '@/components/layout/locale-document-title';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { I18nProvider, applyDocumentTitle, translateMessage } from './i18n';
import { translateSourceText } from './source-text-messages';
import { LAZY_LOCALES } from './locales/catalog';
import { loadLocaleBundle, translateWithBundle } from './locales/loader';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ setupStatus: null }) }));

const prototypeNames = ['constructor', 'toString', '__proto__'];

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); document.head.innerHTML = ''; });

describe('prototype member names are never translations', () => {
  it.each(prototypeNames)('source-text English table leaves "%s" as it is', (name) => {
    expect(() => translateSourceText('en-US', name)).not.toThrow();
    expect(translateSourceText('en-US', name)).toBe(name);
    expect(translateSourceText('en-US', `  ${name} `)).toBe(`  ${name} `);
  });

  it.each(prototypeNames)('each added language falls back to English for "%s"', async (name) => {
    for (const locale of LAZY_LOCALES) {
      const bundle = await loadLocaleBundle(locale);
      const result = translateWithBundle(bundle, name, (text) => translateSourceText('en-US', text));
      expect(result).toBe(name);
      expect(result).not.toMatch(/function|\[native code\]/);
    }
  });

  it.each(prototypeNames)('keyed messages treat "%s" as a missing key', async (name) => {
    for (const locale of LAZY_LOCALES) await loadLocaleBundle(locale);
    for (const locale of ['pt-PT', 'en-US', ...LAZY_LOCALES] as const) {
      expect(translateMessage(locale, name)).toBe(name);
      expect(translateMessage(locale, name, 'Fallback')).toBe('Fallback');
      expect(translateMessage(locale, name, 'Fallback', { count: 2 })).toBe('Fallback');
    }
  });
});

describe('message parameters', () => {
  it('inserts values literally, including $ patterns', () => {
    for (const value of ['$&', '$$', '$`', "$'", '$1', 'a$&b']) {
      expect(translateMessage('en-US', 'missing.key', 'Rack {name}', { name: value })).toBe(`Rack ${value}`);
    }
  });

  it('does not substitute again inside an inserted value', () => {
    expect(translateMessage('en-US', 'missing.key', '{first} and {second}', { first: '{second}', second: 'B' })).toBe('{second} and B');
  });

  it('replaces every occurrence and leaves unknown or inherited tokens alone', () => {
    expect(translateMessage('en-US', 'missing.key', '{a}-{a} {b} {toString}', { a: 1 })).toBe('1-1 {b} {toString}');
  });
});

describe('plural forms in pt-PT and en-US', () => {
  it('pt-PT picks .one and .other from its own table', () => {
    expect(translateMessage('pt-PT', 'topbar.activeAlerts', undefined, { count: 1 })).toBe('1 alerta ativo');
    expect(translateMessage('pt-PT', 'topbar.activeAlerts', undefined, { count: 3 })).toBe('3 alertas ativos');
    // pt-PT (unlike pt-BR) uses "other" for zero.
    expect(translateMessage('pt-PT', 'topbar.activeAlerts', undefined, { count: 0 })).toBe('0 alertas ativos');
  });

  it('en-US picks .one and .other from its own table', () => {
    expect(translateMessage('en-US', 'topbar.activeAlerts', undefined, { count: 1 })).toBe('1 active alert');
    expect(translateMessage('en-US', 'topbar.activeAlerts', undefined, { count: 0 })).toBe('0 active alerts');
    expect(translateMessage('en-US', 'topbar.activeAlerts', undefined, { count: 12 })).toBe('12 active alerts');
  });

  it('uses the plain key when a message has no plural forms, and the fallback when it has none at all', () => {
    expect(translateMessage('en-US', 'meta.title', undefined, { count: 2 })).toBe('Civernode · Infrastructure Management');
    expect(translateMessage('pt-PT', 'meta.title', undefined, { count: 2 })).toBe('Civernode · Gestão de Infraestrutura');
    expect(translateMessage('en-US', 'missing.key', '{count} things', { count: 2 })).toBe('2 things');
    expect(translateMessage('pt-PT', 'missing.key', undefined, { count: 2 })).toBe('missing.key');
  });

  it('a non-numeric count is a plain parameter, not a plural selector', () => {
    expect(translateMessage('en-US', 'topbar.activeAlerts', 'n/a {count}', { count: 'many' })).toBe('n/a many');
  });
});

describe('document title', () => {
  const serverTitle = 'Civernode · Gestão de Infraestrutura';

  async function settle() {
    for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }

  it('applyDocumentTitle rewrites every <title> in <head>, not only the first', () => {
    document.head.innerHTML = `<title>React copy</title><title>${serverTitle}</title>`;
    applyDocumentTitle('Civernode · Gestión de infraestructura');
    expect([...document.head.querySelectorAll('title')].map((title) => title.textContent)).toEqual(['Civernode · Gestión de infraestructura', 'Civernode · Gestión de infraestructura']);
  });

  it.each(LAZY_LOCALES)('%s keeps its title when the server <title> ends up first', async (locale) => {
    const expected = (await loadLocaleBundle(locale)).messages['meta.title'];
    // What the server sends: the Portuguese title, because locale state starts as pt-PT.
    document.head.innerHTML = `<title>${serverTitle}</title>`;
    window.localStorage.setItem(STORAGE_KEYS.locale, locale);
    const view = render(<I18nProvider><LocaleDocumentTitle /><main><h1>404</h1></main></I18nProvider>);
    await settle();
    // A client render (not a hydration) inserts React's own <title> in front and leaves the server's in place.
    const titles = [...document.head.querySelectorAll('title')];
    expect(titles).toHaveLength(2);
    expect(document.title).toBe(expected);
    // Every copy carries the locale's title, so none can surface as stale Portuguese text.
    expect(titles.map((title) => title.textContent)).toEqual([expected, expected]);
    // Move React's copy behind the server's: document.title now reads the server's <title>.
    document.head.append(titles[0]);
    await settle();
    expect(document.title).toBe(expected);
    view.unmount();
  });

  it('a later rewrite of a <title> in <head> is put back to the locale title', async () => {
    document.head.innerHTML = `<title>${serverTitle}</title>`;
    window.localStorage.setItem(STORAGE_KEYS.locale, 'de-DE');
    const expected = (await loadLocaleBundle('de-DE')).messages['meta.title'];
    const view = render(<I18nProvider><LocaleDocumentTitle /></I18nProvider>);
    await settle();
    const stale = document.head.querySelectorAll('title')[1];
    stale.textContent = serverTitle;
    await settle();
    expect(stale.textContent).toBe(expected);
    view.unmount();
  });
});
