import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
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
    },
    resolve: {
        alias: {
            '@sigx/store': resolve(__dirname, 'packages/store/src/index.ts')
        }
    }
});
