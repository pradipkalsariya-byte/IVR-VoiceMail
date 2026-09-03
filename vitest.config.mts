import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The pure gate: core/ has no I/O, no Prisma, no Next imports, so this suite never needs a
// database or a running app. Keep it that way — DB behaviour belongs in a separate lane.
//
// The `@/` alias must be declared here as well as in tsconfig: Next resolves it at build time,
// but Vitest does not read tsconfig paths, so any file importing `@/…` fails to load outright.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
