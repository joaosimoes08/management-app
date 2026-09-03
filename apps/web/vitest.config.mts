import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
