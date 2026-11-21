import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// findBy*/waitFor default to 1 s, which a loaded machine (parallel suites, full disk) can exceed while React Query
// settles. Give async queries more room; the per-test timeout is raised to match in vitest.config.mts.
configure({ asyncUtilTimeout: 4000 });

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
