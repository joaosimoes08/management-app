/**
 * Browser storage keys owned by the app. They were `cociber.*` before the rename to Civernode;
 * reads go through these helpers so a browser that still holds an old key keeps its value once:
 * when the `civernode.*` key is missing and the matching `cociber.*` key exists, the value is
 * copied across and the old key removed.
 */
export const STORAGE_KEY_PREFIX = 'civernode.';
export const LEGACY_STORAGE_KEY_PREFIX = 'cociber.';

export const STORAGE_KEYS = {
  locale: 'civernode.locale',
  siteId: 'civernode.siteId',
  sidebarCollapsed: 'civernode.sidebar.collapsed',
  infrastructureContext: 'civernode.infrastructureContext',
  appearance: 'civernode.appearance',
  rackView: 'civernode.rackView',
} as const;

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageArea = 'local' | 'session';

/** The pre-rename key for an app key, or null for keys that never had a `cociber.` form. */
export function legacyStorageKey(key: string): string | null {
  return key.startsWith(STORAGE_KEY_PREFIX) ? `${LEGACY_STORAGE_KEY_PREFIX}${key.slice(STORAGE_KEY_PREFIX.length)}` : null;
}

/** One-time copy of `cociber.<name>` into `civernode.<name>`; the old key is removed once copied. */
export function migrateStorageKey(storage: KeyValueStorage | null | undefined, key: string): void {
  const legacy = legacyStorageKey(key);
  if (!storage || !legacy) return;
  try {
    if (storage.getItem(key) !== null) return;
    const value = storage.getItem(legacy);
    if (value === null) return;
    storage.setItem(key, value);
    storage.removeItem(legacy);
  } catch {
    // Storage can be unavailable or full (privacy mode); the app then behaves as if nothing was saved.
  }
}

/** Reads a key after migrating its old `cociber.` value, if any. */
export function readStorageItem(storage: KeyValueStorage | null | undefined, key: string): string | null {
  if (!storage) return null;
  migrateStorageKey(storage, key);
  return storage.getItem(key);
}

/** Removes a key and its old `cociber.` form, so a later read cannot bring the old value back. */
export function removeStorageItem(storage: KeyValueStorage | null | undefined, key: string): void {
  if (!storage) return;
  storage.removeItem(key);
  const legacy = legacyStorageKey(key);
  if (legacy) storage.removeItem(legacy);
}

function browserStorage(area: StorageArea): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return area === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}

/** `localStorage.getItem` with the one-time migration; null on the server or without storage. */
export function getLocalItem(key: string): string | null {
  return readStorageItem(browserStorage('local'), key);
}

/** `sessionStorage.getItem` with the one-time migration; null on the server or without storage. */
export function getSessionItem(key: string): string | null {
  return readStorageItem(browserStorage('session'), key);
}

export function removeLocalItem(key: string): void {
  removeStorageItem(browserStorage('local'), key);
}

/**
 * The same migration as `migrateStorageKey`, as inline script text for code that runs before the
 * app bundle (the theme boot script). `storageExpr` is the storage object expression, `key` the new key.
 */
export function migrateStorageKeyScript(storageExpr: string, key: string): string {
  const legacy = legacyStorageKey(key);
  if (!legacy) return '';
  return `(function(s,k,o){try{if(s.getItem(k)===null){var v=s.getItem(o);if(v!==null){s.setItem(k,v);s.removeItem(o);}}}catch(e){}})(${storageExpr},${JSON.stringify(key)},${JSON.stringify(legacy)});`;
}
