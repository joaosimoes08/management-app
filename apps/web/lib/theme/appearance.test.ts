import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_STORAGE_KEY, appearanceBootScript, loadAppearanceForUser, parseAppearance, resetAppearanceStoreForTests, resolveMode, setAppearance, userAppearanceKey } from './appearance';

function mockSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: dark && query.includes('dark'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
function runBootScript() { new Function(appearanceBootScript)(); }
const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  resetAppearanceStoreForTests();
  root().removeAttribute('data-theme');
  root().removeAttribute('data-mode');
  mockSystemDark(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('appearance preference', () => {
  it('parses saved values and falls back to the default for unknown ones', () => {
    expect(parseAppearance('{"theme":"sand-teal","mode":"dark"}')).toEqual({ theme: 'sand-teal', mode: 'dark' });
    expect(parseAppearance('{"theme":"neon","mode":"sepia"}')).toEqual({ theme: 'default', mode: 'light' });
    expect(parseAppearance('not json')).toBeNull();
    expect(parseAppearance(null)).toBeNull();
  });

  it('resolves the system mode from the OS setting', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });

  it('boot script applies the saved theme before React loads', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'zinc-indigo', mode: 'dark' }));
    runBootScript();
    expect(root().getAttribute('data-theme')).toBe('zinc-indigo');
    expect(root().getAttribute('data-mode')).toBe('dark');
  });

  it('boot script follows the OS in system mode and defaults to the current look', () => {
    mockSystemDark(true);
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'slate-blue', mode: 'system' }));
    runBootScript();
    expect(root().getAttribute('data-mode')).toBe('dark');
    window.localStorage.clear();
    runBootScript();
    expect(root().getAttribute('data-theme')).toBe('default');
    expect(root().getAttribute('data-mode')).toBe('light');
  });

  it('saves the choice for this browser and for the signed-in user', () => {
    loadAppearanceForUser('user-1');
    setAppearance({ theme: 'stone-emerald', mode: 'dark' });
    expect(root().getAttribute('data-theme')).toBe('stone-emerald');
    expect(root().getAttribute('data-mode')).toBe('dark');
    expect(parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY))).toEqual({ theme: 'stone-emerald', mode: 'dark' });
    expect(parseAppearance(window.localStorage.getItem(userAppearanceKey('user-1')))).toEqual({ theme: 'stone-emerald', mode: 'dark' });
  });

  it("restores each user's own theme when they sign in", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'stone-emerald', mode: 'dark' }));
    window.localStorage.setItem(userAppearanceKey('user-2'), JSON.stringify({ theme: 'high-contrast', mode: 'light' }));
    loadAppearanceForUser('user-2');
    expect(root().getAttribute('data-theme')).toBe('high-contrast');
    expect(root().getAttribute('data-mode')).toBe('light');
    expect(parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY))).toEqual({ theme: 'high-contrast', mode: 'light' });
  });
});
