import { defineConfig } from 'vitest/config';

// Tests tegen een echte Postgres (TEST_DATABASE_URL), via `npm run test:pg`. De gewone tests draaien op PGlite met één verbinding en
// kunnen echte gelijktijdigheid (transacties, locks, unieke indexen onder druk) niet bewijzen.
export default defineConfig({ test: { include: ['server/tests-pg/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false } });
