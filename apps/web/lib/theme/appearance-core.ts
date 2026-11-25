// Shared by the server layout (boot script) and the client store; no 'use client' here, so the layout
// gets the real string rather than a client reference.
import { DEFAULT_MODE, DEFAULT_THEME, themeIds, type ThemeId, type ThemeMode, type ThemeModePreference } from './themes';
import { STORAGE_KEYS, migrateStorageKeyScript } from '../storage-keys';

export type Appearance = { theme: ThemeId; mode: ThemeModePreference };

/** Last choice made in this browser. The boot script reads it before first paint. */
export const APPEARANCE_STORAGE_KEY = STORAGE_KEYS.appearance;
/** Each user's own choice, so people sharing a browser keep their theme. */
export const userAppearanceKey = (userId: string) => `${APPEARANCE_STORAGE_KEY}.${userId}`;

export const defaultAppearance: Appearance = { theme: DEFAULT_THEME, mode: DEFAULT_MODE };

export function parseAppearance(raw: string | null | undefined): Appearance | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Appearance>;
    const theme = themeIds.includes(value.theme as ThemeId) ? value.theme as ThemeId : DEFAULT_THEME;
    const mode = value.mode === 'light' || value.mode === 'dark' || value.mode === 'system' ? value.mode : DEFAULT_MODE;
    return { theme, mode };
  } catch {
    return null;
  }
}

export function resolveMode(mode: ThemeModePreference, prefersDark: boolean): ThemeMode {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

export const darkQuery = '(prefers-color-scheme: dark)';

/**
 * Inline script for <head>: applies the saved theme before the first paint so the page never flashes
 * the default colours. Keep it in step with parseAppearance/resolveMode (covered by appearance.test.ts).
 */
export const appearanceBootScript = `${migrateStorageKeyScript('localStorage', APPEARANCE_STORAGE_KEY)}(function(){try{var d=document.documentElement,a=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||'null')||{},ids=${JSON.stringify(themeIds)},m=a.mode==='light'||a.mode==='dark'||a.mode==='system'?a.mode:${JSON.stringify(DEFAULT_MODE)};if(m==='system')m=window.matchMedia&&window.matchMedia(${JSON.stringify(darkQuery)}).matches?'dark':'light';d.setAttribute('data-theme',ids.indexOf(a.theme)>=0?a.theme:${JSON.stringify(DEFAULT_THEME)});d.setAttribute('data-mode',m);}catch(e){}})();`;
