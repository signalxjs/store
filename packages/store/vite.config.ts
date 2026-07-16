import { defineLibConfig } from '@sigx/vite/lib';
import type { ConfigEnv, UserConfig } from 'vite';

// Standard sigx first-party lib build: a dev pass (`vite build`) emits
// dist/<entry>.js, a prod pass (`vite build --mode prod-dist`) emits
// dist/<entry>.prod.js with `__DEV__` pinned to `false` so the minifier strips
// dev-only blocks. `.d.ts` come from the separate `tsc --emitDeclarationOnly`.
const base = defineLibConfig({
    entry: {
        index: 'src/index.ts',
        persist: 'src/persist.ts',
        ssr: 'src/ssr.ts'
    },
    external: [/@sigx\/.*/, /^node:/],
    root: import.meta.url
}) as (env: ConfigEnv) => UserConfig;

export default (env: ConfigEnv): UserConfig => {
    const config = base(env);
    // #36: the dev/import dist must not assume a `process` global. defineLibConfig
    // emits bare `(process.env.NODE_ENV !== 'production')` for the dev pass; keep
    // the `typeof process` guard so unbundled runtimes without `process` don't
    // throw on a dev-guarded path. The prod-dist pass keeps `__DEV__ = false`
    // (stripped) — leave it untouched.
    if (env.mode !== 'prod-dist') {
        config.define = {
            ...config.define,
            __DEV__: "(typeof process !== 'undefined' && process.env.NODE_ENV !== 'production')"
        };
    }
    return config;
};
