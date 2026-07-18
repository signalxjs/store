# Changelog

All notable changes to `@sigx/store` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.9.0] - 2026-07-18

### Changed (breaking)

- Migrated to sigx core **`0.12.0`** and **narrowed** the peer range to a single minor: `@sigx/reactivity`/`@sigx/runtime-core` are now `^0.12.0`, down from the widened `>=0.5.0 <0.11.0` band accumulated across #50/#56. Store imports only stable low-level symbols (`signal`/`watch`/`batch`/`untrack`/`computed`/`isComputed`, Topic v2, `defineFactory`, `getCurrentInstance`, `isLiveClient`/`declareLiveClient`) plus the SSR state-transfer contract (`stateSerializationPlugin`, `window.__SIGX_ASYNC__`), none of which changed across 0.10→0.12 — verified with typecheck, tests and build against 0.12.0. The single-minor pin restores core's single-copy guarantee the widened band gave up (a second `@sigx/reactivity` copy silently splits core's module-local singletons). Install alongside the same core minor: `npm i @sigx/store @sigx/runtime-core@^0.12.0 @sigx/reactivity@^0.12.0`. (#64)

### Changed

- Build: the core version is now sourced from a pnpm **`catalog:`** in `pnpm-workspace.yaml` (`@sigx/reactivity`/`@sigx/runtime-core`/`@sigx/server-renderer`/`@sigx/vite`/`sigx` at `^0.12.0`) so a framework bump is a one-place edit; `pnpm pack` rewrites `catalog:` to `^0.12.0` in the published manifest. Internal only. (#64)
- Build: the package now builds with `@sigx/vite`'s `defineLibConfig` (two vite passes + `tsc --emitDeclarationOnly`) instead of `tsgo`, and dev-only warnings are guarded by the `__DEV__` compile-time flag. New export conditions ship a stripped `production` dist (`dist/*.prod.js`, no dev warnings) alongside the default/`import` dev dist. The `typeof process` guard from #36 is preserved via a dev-pass `__DEV__` define override in `vite.config.ts`, so the dev dist still tolerates runtimes without a `process` global. `.size-limit.json` now measures the prod dist. No public API or runtime-behavior change (#60).
- `ssrState()` now gates client seeding on core's `isLiveClient()` (from `@sigx/runtime-core/internals`) instead of a bare `typeof window` check, and reads the transfer blob windowless-safely (`globalThis` fallback, `window` referenced only when it exists). Behavior is identical on web and SSR — `isLiveClient()` defaults to the browser check — but windowless client runtimes (e.g. lynx, terminal) that declare themselves live now seed instead of silently no-op'ing (#58).
- Docs: documented that `onStoreCreated`'s plugin registry and the internal per-instance counter are intentionally process-global. Under SSR the plugin hook applies to every app/request (register once at startup), and the monotonic counter keeps concurrent requests' topic namespaces distinct in core's global topic registry. An audit confirmed neither is a per-request leak, so no `defineInjectable` migration was warranted (#58).

## [0.8.0] - 2026-07-16

### Changed

- Support `@sigx/reactivity` and `@sigx/runtime-core` `0.10.0` — peer range widened from `>=0.5.0 <0.8.0` to `>=0.5.0 <0.11.0` (#56). Core's `0.8`/`0.9`/`0.10` breaking changes (TypeScript 7 migration; retiring `Suspense`/`ErrorBoundary` for the value-first async model; DI token seams; the new SSR boundary model) don't touch the store, which imports only stable reactivity/runtime-core symbols and the SSR state-transfer contract (`getCurrentInstance`, the per-request `_asyncResults` map, `window.__SIGX_ASYNC__` via `stateSerializationPlugin`) that core still ships. Dev dependencies (`@sigx/reactivity`, `@sigx/runtime-core`, `@sigx/server-renderer`, `sigx`) bumped to `^0.10.0`; verified with typecheck, tests and build against 0.10.0.
- Support `@sigx/reactivity` and `@sigx/runtime-core` `0.7.0` — peer range widened from `>=0.5.0 <0.7.0` to `>=0.5.0 <0.8.0` (#50). Core 0.7.0's breaking changes (slot-presence semantics; removal of the deprecated flat `Define*` type aliases) don't touch the store, which imports only stable reactivity/runtime-core symbols. Dev dependencies (`@sigx/reactivity`, `@sigx/runtime-core`, `@sigx/server-renderer`, `sigx`) bumped to `^0.7.0`; verified with typecheck, tests and build against 0.7.0.

## [0.7.0] - 2026-06-14

### Added

- **`@sigx/store/ssr`** (new package entry): `ssrState(ctx, { state, patch }, options?)` — call inside a store setup (persist-style) to transfer the slice from server render to client hydration. Server: registers a live, `toJSON`-deferred snapshot under `store:<name>` on the per-request render context — the core `stateSerializationPlugin` (automatic under `renderDocument`) emits it in `window.__SIGX_ASYNC__` with final post-mutation values; no `@sigx/server-renderer` dependency in this package (duck-typed boundary). Client: seeds via one atomic `patch()`, consume-once, browser-gated (reads `window.__SIGX_ASYNC__` first, then `globalThis`), always filtered to the slice's known keys (∩ `pick`) so tampered blobs can't assign unexpected keys. Returns `{ hydrated }`. Composes with `persist()` — call `ssrState` first; device-local data wins. (#26)

## [0.6.1] - 2026-06-13

### Fixed

- **Action-wrapper bookkeeping no longer subscribes the caller's reactive context** (#42). The wrapper's `inflight` counter is a reactive signal and its `++` is a read-modify-write executed in the caller's tracking context — calling any action (even a pure getter) from a render/effect subscribed that context to the wrapper's internals, and the settle write (`--`, sync or in the async settle) re-triggered it: an infinite re-run loop at microtask speed that froze the page with no error. All wrapper bookkeeping (inflight `++`/`--` in every path, lifecycle-topic `hasSubscribers`/`publish`) now runs in `untrack()`. The action body stays tracked (its reads are the caller's legitimate dependencies) and `.pending` stays reactive for intentional subscribers. Note: an action whose body *writes* reactive state still self-loops when called from a render closure — by design (body writes are real state changes); fetch/resolve in `watch`/`onMounted` instead and let the render read the store state (see "Actions in renders" in the README).

## [0.6.0] - 2026-06-12

### Changed (breaking)

- `@sigx/runtime-core` and `@sigx/reactivity` are now `peerDependencies` (`>=0.5.0 <0.7.0`) instead of regular dependencies — prevents a second core copy from splitting singleton state (topic registry, DI app-context token, `instanceof` identity). Most apps already have core installed via `sigx`.

### Changed

- Error reporting follows the sigx dev-env convention: development builds log labeled messages (`[@sigx/store] …`), production logs the bare error so failures stay visible while label strings become strippable by consumer `NODE_ENV` defines (#34). The `NODE_ENV` gates are guarded with `typeof process !== 'undefined'` so runtimes without a `process` global don't crash (#36).

## [0.5.0] - 2026-06-10

Full store redesign (#20) — flat signal-first surface, fixed action semantics, lazy events, persistence, plugins. Built on core `0.5.0` (real DI lifetimes, Topic v2).

### Changed (breaking)

- **Flat store surface.** The store instance is now an unwrap proxy over the setup return: key signals read/write as plain values (`store.todos`), returned `computed(...)` values read as plain read-only values (`store.remaining`), actions and other values pass through. The old grouped access (`store.state.count`, `store.get.total.value`) is gone.
- **`defineState` returns `{ state, signals, events, patch }`** — `mutate` is removed (state is deeply reactive; `patch()` covers atomic multi-key updates and `state.x = y` covers the rest). Spread `signals` into the setup return to make keys public; unreturned keys are private.
- **State events renamed and made lazy.** `events.onMutatedCount` → `events.count` (and `store.$events.count` on the instance) with `(value, prev)` callbacks. Topics are created eagerly (devtools-discoverable) but their deep watchers run only while subscribed (refCount) — no per-key watcher cost for unobserved state, and no immediate fire on subscribe.
- **Per-action event namespacing.** `actions.onDispatching.save` → `store.save.onDispatching` (events ride on the action function). Setup-side: `actions.save.onDispatching`.
- **Store meta behind `$`**: `$id` (friendly `name#1` instead of guid-suffixed names; no `name` key injected into the store), `$patch`, `$events`, `$dispose`.
- **`defineStore` lifetime is honored** (`'singleton' | 'scoped' | 'transient'`, default `'scoped'`) — requires core `0.5.0`, where factory lifetimes are implemented.
- Removed exports: `StoreEvents`, `StoreReturnDefineAction`, `IReturnSetupStore`, `MutateFn`.

### Added

- **`pending`** — reactive per-action in-flight flag (`store.save.pending`), count-based across overlapping invocations.
- **`defineEvents<EventMap>()`** — typed custom events on the setup context (core `createTopicGroup`), auto-namespaced and destroyed with the store.
- **`onStoreCreated(plugin)`** — global plugin hook running for every store instance with `{ name, instanceId, instance, onDeactivated }`; registration-ordered, error-isolated.
- **`storeToSignals(store)`** — destructuring-safe signal views over state keys and computeds.
- **`@sigx/store/persist`** — persistence composable: sync/async `StorageLike` (localStorage default, AsyncStorage compatible), `pick`, `version`+`migrate`, `debounce`, reactive `hydrated` + `whenHydrated`, saving paused until hydration completes, SSR no-op, full cleanup on disposal.
- `expectTypeOf` type tests pinning the full typing contract (exact action signatures, `$patch`/`$events` keyed by returned signals, read-only computeds).

### Fixed

- **Async `onDispatched` publishes the resolved value** — previously it published the pending promise itself.
- **Async rejections fire `onFailure`** — previously the missing rejection handler meant failures never reached subscribers and surfaced as unhandled rejections.
- **Sync action errors propagate to the caller** — previously they were swallowed (`console.error` + `undefined` return). Actions now return the original promise, so callers observe rejections, while an internal handled side chain keeps fire-and-forget calls free of unhandled-rejection noise.
- **Store disposal actually stops state watchers** — previously the disposal path relied on core's `effectScope`, whose cleanup was a no-op, leaking watchers for every disposed store.

## [0.4.4] - 2026-05-12

### Changed

- Bump `@sigx/reactivity` and `@sigx/runtime-core` dependency ranges to `^0.4.3` and rebuild against core `0.4.3`. Picks up the upstream fixes shipped in core `0.4.2` and `0.4.3`. No store API changes.

## [0.4.3] - 2026-05-10

### Changed

- First release published via GitHub Actions with npm provenance attestation. Functionally identical to `0.4.2`.

## [0.4.2] - 2026-05-10

### Changed

- First release from the dedicated [`signalxjs/store`](https://github.com/signalxjs/store) repo. Source extracted from the SignalX incubation repo with no API changes.
- `repository`, `homepage`, and `bugs` fields now point at `signalxjs/store`.
