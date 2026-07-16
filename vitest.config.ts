import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    // `__DEV__` is the compile-time dev flag package sources guard on; the build
    // (vite.config.ts) replaces it in the dists, so tests must define it too.
    define: {
        __DEV__: 'true'
    },
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    },
    test: {
        environment: 'happy-dom',
        include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**'],
        globals: true,
        typecheck: {
            // Enforce the *.test-d.ts typing-contract files on every test run.
            enabled: true,
            include: ['packages/**/__tests__/**/*.test-d.ts'],
        },
    },
    resolve: {
        alias: {
            '@sigx/store': resolve(__dirname, 'packages/store/src/index.ts')
        }
    }
});
