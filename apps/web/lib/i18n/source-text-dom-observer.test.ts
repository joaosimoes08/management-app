import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSourceTextMessages, observeSourceTextDom, translateSourceTextDom } from './i18n';
import { sourceTextEnglishMessages, translateSourceText } from './source-text-messages';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ authenticated: false, loading: false }) }));

const [first, second, third] = Object.keys(sourceTextEnglishMessages).filter((key) => translateSourceText('en-US', key) !== key).slice(0, 3);
const en = (text: string) => translateSourceText('en-US', text);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Subtree walks made by the translation layer (jsdom's querySelector also uses tree walkers, with other filters). */
const layerWalks = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((call) => call[1] === (NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)).length;

// The English source-text table loads on demand; load it once so the translations below are synchronous.
beforeAll(async () => { await loadSourceTextMessages(); });

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  // Leave the module in its Portuguese state for the next test.
  observeSourceTextDom('pt-PT', document.body)();
});

describe('source-text DOM observer', () => {
  it('translates the data-label that phone card layouts show before each table cell', () => {
    const root = document.createElement('div');
    root.innerHTML = '<table><tbody><tr><td data-label="Última trap">x</td><td data-label="IP de origem">y</td></tr></tbody></table>';
    translateSourceTextDom('en-US', root);
    expect([...root.querySelectorAll('td')].map((cell) => cell.getAttribute('data-label'))).toEqual(['Last trap', 'Source IP']);
    translateSourceTextDom('pt-PT', root);
  });

  it('translates added nodes, edited text and edited attributes in en-US', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const disconnect = observeSourceTextDom('en-US', root);

    const button = document.createElement('button');
    button.setAttribute('aria-label', first);
    button.textContent = second;
    root.append(button);
    await flush();
    expect(button.getAttribute('aria-label')).toBe(en(first));
    expect(button.textContent).toBe(en(second));

    (button.firstChild as Text).nodeValue = third;
    button.setAttribute('aria-label', second);
    await flush();
    expect(button.textContent).toBe(en(third));
    expect(button.getAttribute('aria-label')).toBe(en(second));
    disconnect();
  });

  it('touches only what changed: no subtree walk for an attribute or text edit, one walk per added subtree', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<table title="${first}"><tbody><tr><td>${second}</td><td>${third}</td></tr></tbody></table>`;
    document.body.append(root);
    const disconnect = observeSourceTextDom('en-US', root);
    const walker = vi.spyOn(document, 'createTreeWalker');

    root.querySelector('table')!.setAttribute('title', second);
    (root.querySelector('td')!.firstChild as Text).nodeValue = first;
    await flush();
    expect(layerWalks(walker)).toBe(0);
    expect(root.querySelector('table')!.getAttribute('title')).toBe(en(second));
    expect(root.querySelector('td')!.textContent).toBe(en(first));

    const rows = document.createElement('tbody');
    rows.innerHTML = `<tr><td>${first}</td></tr><tr><td>${third}</td></tr>`;
    root.querySelector('tbody')!.replaceWith(rows);
    await flush();
    expect(layerWalks(walker)).toBe(1);
    expect([...rows.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([en(first), en(third)]);

    // The observer's own edits are not processed again in a later batch.
    walker.mockClear();
    await flush();
    expect(layerWalks(walker)).toBe(0);
    disconnect();
  });

  it('restores Portuguese once when switching back and does not observe in pt-PT', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<span title="${first}">${second}</span>`;
    document.body.append(root);
    observeSourceTextDom('en-US', root)();
    expect(root.querySelector('span')!.textContent).toBe(en(second));

    const observerSpy = vi.spyOn(window, 'MutationObserver');
    const walker = vi.spyOn(document, 'createTreeWalker');
    const disconnect = observeSourceTextDom('pt-PT', root);
    expect(root.querySelector('span')!.textContent).toBe(second);
    expect(root.querySelector('span')!.getAttribute('title')).toBe(first);
    expect(observerSpy).not.toHaveBeenCalled();
    disconnect();

    // Nothing left to restore: a second Portuguese pass does no work.
    walker.mockClear();
    observeSourceTextDom('pt-PT', root)();
    expect(layerWalks(walker)).toBe(0);
  });

  it('keeps translateSourceTextDom usable on its own', () => {
    const span = document.createElement('span');
    span.textContent = first;
    translateSourceTextDom('en-US', span);
    expect(span.textContent).toBe(en(first));
    translateSourceTextDom('pt-PT', span);
    expect(span.textContent).toBe(first);
  });
});
