'use client';

import { useSyncExternalStore } from 'react';
import { APPEARANCE_STORAGE_KEY, darkQuery, defaultAppearance, parseAppearance, resolveMode, userAppearanceKey, type Appearance } from './appearance-core';

export { APPEARANCE_STORAGE_KEY, appearanceBootScript, parseAppearance, resolveMode, userAppearanceKey, type Appearance } from './appearance-core';

const prefersDark = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(darkQuery).matches;

export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement) {
  root.setAttribute('data-theme', appearance.theme);
  root.setAttribute('data-mode', resolveMode(appearance.mode, prefersDark()));
}

// --- Store ----------------------------------------------------------------------------------------
let current: Appearance = defaultAppearance;
let initialised = false;
let currentUserId: string | null = null;
const listeners = new Set<() => void>();

function storage() { try { return window.localStorage; } catch { return null; } }

function ensureInitialised() {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  current = parseAppearance(storage()?.getItem(APPEARANCE_STORAGE_KEY)) ?? defaultAppearance;
}

function emit() { for (const listener of listeners) listener(); }

function save(next: Appearance) {
  const raw = JSON.stringify(next);
  storage()?.setItem(APPEARANCE_STORAGE_KEY, raw);
  if (currentUserId) storage()?.setItem(userAppearanceKey(currentUserId), raw);
}

export function setAppearance(next: Partial<Appearance>) {
  ensureInitialised();
  current = { ...current, ...next };
  save(current);
  applyAppearance(current);
  emit();
}

/** Called when the signed-in user is known: use their saved choice, or adopt this browser's one. */
export function loadAppearanceForUser(userId: string | null) {
  ensureInitialised();
  currentUserId = userId;
  if (!userId) return;
  const saved = parseAppearance(storage()?.getItem(userAppearanceKey(userId)));
  if (saved && (saved.theme !== current.theme || saved.mode !== current.mode)) {
    current = saved;
    storage()?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(saved));
    applyAppearance(current);
    emit();
  } else if (!saved) {
    storage()?.setItem(userAppearanceKey(userId), JSON.stringify(current));
  }
}

/** Follow the operating system's light/dark setting while the "system" mode is chosen. */
export function watchSystemMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(darkQuery);
  const onChange = () => { ensureInitialised(); if (current.mode === 'system') { applyAppearance(current); emit(); } };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function snapshot() { ensureInitialised(); return current; }
function serverSnapshot() { return defaultAppearance; }

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { ...appearance, resolvedMode: resolveMode(appearance.mode, prefersDark()), setAppearance };
}

/** Test helper: forget the in-memory state so the next read comes from storage again. */
export function resetAppearanceStoreForTests() { initialised = false; current = defaultAppearance; currentUserId = null; listeners.clear(); }
