import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@flash-dns/types': fileURLToPath(new URL('./packages/types/src/index.ts', import.meta.url)), '@flash-dns/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)), '@flash-dns/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)), '@flash-dns/adapter-cloudflare': fileURLToPath(new URL('./packages/adapter-cloudflare/src/index.ts', import.meta.url)), '@flash-dns/cli': fileURLToPath(new URL('./packages/cli/src/index.ts', import.meta.url)), 'flash-dns': fileURLToPath(new URL('./packages/flash-dns/src/index.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 15000 }
})
