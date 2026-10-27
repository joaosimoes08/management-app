import '@testing-library/jest-dom/vitest';

// Node's native localStorage getter can shadow jsdom's storage on newer Node versions.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window.localStorage,
});
