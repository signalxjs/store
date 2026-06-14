# Changelog

All notable changes to `@sigx/store`. The package also keeps a per-package `packages/store/CHANGELOG.md`.

## [Unreleased]

## 0.7.0 — 2026-06-14

### Added

- **`@sigx/store/ssr`**: `ssrState(ctx, { state, patch }, options?)` — a persist-style one-liner that transfers store state from server render to client hydration. The server registers a live `toJSON`-deferred snapshot under `store:<name>`, emitted into `window.__SIGX_ASYNC__` by the core `stateSerializationPlugin` (zero `@sigx/server-renderer` dependency in this package); the client seeds via one atomic `patch()`, consume-once and browser-gated. `pick` filters the wire both ways; composes with `persist()` (call `ssrState` first). (#26, #27)

## 0.6.1 — 2026-06-13

### Fixed

- **`@sigx/store`**: the action wrapper's bookkeeping (the `pending` inflight counter and lifecycle-topic plumbing) now runs in `untrack()` — calling an action inside a reactive context (render/effect) no longer subscribes that context to the wrapper's internals, which previously caused an infinite re-run loop at microtask speed (frozen page, no error). Action-body reads stay tracked; `.pending` stays reactive (#42).

## 0.6.0 — 2026-06-12

### Changed (breaking)

- **`@sigx/store`**: `@sigx/runtime-core` and `@sigx/reactivity` are now `peerDependencies` (`>=0.5.0 <0.7.0`) instead of regular dependencies. Regular deps could resolve a second copy of core next to the app's (e.g. app on core 0.6 + store's `^0.5.0`), silently splitting core's singleton state — the topic registry, DI app-context token, and `instanceof` identity. With peers, the app's single copy is always used. Install: `npm i @sigx/store @sigx/runtime-core @sigx/reactivity` (most apps already have core via `sigx`).

### Changed

- Error reporting follows the sigx dev-env convention: development builds log labeled messages (`[@sigx/store] …`), production logs the bare error; the `NODE_ENV` gates are runtime-safe where no `process` global exists (#34, #36).

## 0.5.0 — 2026-06-10

- Full store redesign (#20) — flat signal-first surface, fixed action semantics, lazy events, persistence, plugins. Built on core `0.5.0` (real DI lifetimes, Topic v2). See `packages/store/CHANGELOG.md` for the full breakdown.

## 0.4.4 — 2026-05-12

- Bump core dependency ranges to `^0.4.3` and rebuild against core `0.4.3`. No store API changes.

## 0.4.3 — 2026-05-10

- First release published via GitHub Actions with npm provenance attestation. Functionally identical to `0.4.2`.

## 0.4.2 — 2026-05-10

- Initial release of `signalxjs/store`. Source extracted from the `viewti/lynx` incubation repo.
