import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['server/tests/**/*.test.{ts,tsx}'], testTimeout: 90_000, hookTimeout: 60_000 },
});
