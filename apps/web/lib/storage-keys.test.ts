import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS, getLocalItem, getSessionItem, legacyStorageKey, migrateStorageKey, migrateStorageKeyScript, readStorageItem, removeLocalItem } from './storage-keys';
import { readInfrastructureContext, readRackView } from '@/features/infrastructure/utils';
import { appearanceBootScript, userAppearanceKey } from '@/lib/theme/appearance-core';

afterEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

// Every key the app stored as cociber.* before the rename, with a value of the shape it holds.
const localKeys: Array<[name: string, key: string, value: string]> = [
  ['locale', STORAGE_KEYS.locale, 'en-US'],
  ['siteId', STORAGE_KEYS.siteId, 'site-1'],
  ['sidebar.collapsed', STORAGE_KEYS.sidebarCollapsed, 'true'],
  ['infrastructureContext', STORAGE_KEYS.infrastructureContext, JSON.stringify({ siteId: 's', buildingId: 'b', roomId: 'r' })],
  ['appearance', STORAGE_KEYS.appearance, JSON.stringify({ theme: 'zinc-indigo', mode: 'dark' })],
  ['appearance.<userId>', userAppearanceKey('user-1'), JSON.stringify({ theme: 'sand-teal', mode: 'light' })],
];

describe('storage keys', () => {
  it('uses civernode.* names and maps each to its old cociber.* name', () => {
    expect(Object.values(STORAGE_KEYS)).toEqual(['civernode.locale', 'civernode.siteId', 'civernode.sidebar.collapsed', 'civernode.infrastructureContext', 'civernode.appearance', 'civernode.rackView']);
    expect(legacyStorageKey('civernode.sidebar.collapsed')).toBe('cociber.sidebar.collapsed');
    expect(legacyStorageKey('management-app:recent-items:u')).toBeNull();
  });

  it.each(localKeys)('migrates cociber.%s from localStorage once, then removes the old key', (name, key, value) => {
    window.localStorage.setItem(`cociber.${name === 'appearance.<userId>' ? 'appearance.user-1' : name}`, value);
    expect(getLocalItem(key)).toBe(value);
    expect(window.localStorage.getItem(key)).toBe(value);
    expect(window.localStorage.getItem(legacyStorageKey(key)!)).toBeNull();
  });

  it('migrates cociber.rackView from sessionStorage once, then removes the old key', () => {
    window.sessionStorage.setItem('cociber.rackView', 'rear');
    expect(getSessionItem(STORAGE_KEYS.rackView)).toBe('rear');
    expect(window.sessionStorage.getItem('civernode.rackView')).toBe('rear');
    expect(window.sessionStorage.getItem('cociber.rackView')).toBeNull();
  });

  it('keeps an existing civernode.* value and does not touch the old key then', () => {
    window.localStorage.setItem('civernode.locale', 'pt-PT');
    window.localStorage.setItem('cociber.locale', 'en-US');
    expect(getLocalItem(STORAGE_KEYS.locale)).toBe('pt-PT');
    expect(window.localStorage.getItem('cociber.locale')).toBe('en-US');
  });

  it('returns null when neither key exists and when storage is missing', () => {
    expect(getLocalItem(STORAGE_KEYS.siteId)).toBeNull();
    expect(readStorageItem(null, STORAGE_KEYS.siteId)).toBeNull();
    expect(() => migrateStorageKey(undefined, STORAGE_KEYS.siteId)).not.toThrow();
  });

  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined, removeItem: () => undefined };
    expect(() => migrateStorageKey(broken, STORAGE_KEYS.locale)).not.toThrow();
  });

  it('removes both forms, so a cleared key is not brought back from the old one', () => {
    window.localStorage.setItem('cociber.infrastructureContext', '{"siteId":"old"}');
    window.localStorage.setItem('civernode.infrastructureContext', '{"siteId":"new"}');
    removeLocalItem(STORAGE_KEYS.infrastructureContext);
    expect(getLocalItem(STORAGE_KEYS.infrastructureContext)).toBeNull();
  });

  it('migrates through the app readers that use these keys', () => {
    window.localStorage.setItem('cociber.infrastructureContext', JSON.stringify({ siteId: 's', buildingId: 'b', roomId: 'r' }));
    expect(readInfrastructureContext()).toEqual({ siteId: 's', buildingId: 'b', roomId: 'r' });
    window.sessionStorage.setItem('cociber.rackView', 'rear');
    expect(readRackView(800)).toBe('rear');
    expect(window.sessionStorage.getItem('cociber.rackView')).toBeNull();
  });

  it('the theme boot script migrates cociber.appearance before first paint', () => {
    window.localStorage.setItem('cociber.appearance', JSON.stringify({ theme: 'zinc-indigo', mode: 'dark' }));
    new Function(appearanceBootScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('zinc-indigo');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(window.localStorage.getItem('civernode.appearance')).toContain('zinc-indigo');
    expect(window.localStorage.getItem('cociber.appearance')).toBeNull();
  });

  it('builds no inline migration for keys without an old form', () => {
    expect(migrateStorageKeyScript('localStorage', 'management-app:x')).toBe('');
  });
});
