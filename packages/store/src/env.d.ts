/**
 * Compile-time dev flag. Replaced at build time by the package's `vite.config.ts`:
 * `false` in the prod dist (`*.prod.js` — dev-only blocks are stripped by the
 * minifier), and a `typeof process`-guarded NODE_ENV check in the dev dist
 * (`*.js`) so runtimes without a `process` global don't throw (see #36). Defined
 * as `true` for tests via `vitest.config.ts`.
 *
 * Guard dev-only code with `if (__DEV__)` — never a literal `process.env.NODE_ENV`.
 */
declare const __DEV__: boolean;
