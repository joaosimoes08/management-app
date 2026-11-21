import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Node's native localStorage getter can shadow jsdom's storage on newer Node versions.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window.localStorage,
});

// Components read the API's power defaults through a React Query hook; tests render them without a QueryClient,
// so every suite gets the fixture unless it mocks the hook itself.
vi.mock('@/features/infrastructure/use-power-defaults', async () => {
  const { TEST_POWER_DEFAULTS } = await import('@/features/infrastructure/__fixtures__/power-defaults');
  return { POWER_DEFAULTS_QUERY_KEY: ['infrastructure', 'power-defaults'], usePowerDefaults: () => TEST_POWER_DEFAULTS };
});
