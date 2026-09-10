import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true
  },
  test: {
    // RPC suites include local Auth password hashing and concurrent requests.
    testTimeout: 15000,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
  }
});
