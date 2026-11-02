import { defineProject } from 'vitest/config';

// Pure-logic tests only (no react-native imports): vitest runs them under
// node, which cannot load RN or Expo modules. UI flows are maestro's job
// (`bun run maestro:test`).
export default defineProject({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
