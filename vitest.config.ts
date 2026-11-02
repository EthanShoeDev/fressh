import { defineConfig } from 'vitest/config';

// One project per package with tests.
export default defineConfig({
  test: {
    projects: ['apps/mobile'],
  },
});
