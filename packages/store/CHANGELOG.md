# Changelog

All notable changes to `@sigx/store` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.13.0] - 2026-08-04

### Changed

- Migrated to sigx core **`0.15.0`**: the `catalog:` pins for `@sigx/reactivity`/`@sigx/runtime-core`/`@sigx/server-renderer`/`@sigx/vite`/`sigx` move from `^0.14.0` to `^0.15.0`, which narrows the published peer range to that single minor. (#83)
- **`ssrState()` and a `__proto__`-tampered blob entry**: under core ≤0.14 such an entry arrived from the codec with its prototype swapped and was rejected *wholesale* — no keys applied, `hydrated: false`. Core 0.15's codec (signalxjs/core#592) now drops an own `"__proto__"` key during revive, so the entry arrives sanitized and its remaining legitimate keys **are applied** (`hydrated: true`). `Object.prototype` was never touched on either path, the reserved-key allow-list (`__proto__`/`constructor`/`prototype`) still applies, and no legitimate producer emits that shape — this only changes what an attacker-shaped blob observes. If you relied on wholesale rejection as a tamper signal, that signal is gone: core now sanitizes instead of poisoning the shape. (#83)

## [0.12.0] - 2026-07-29

### Changed

- Migrated to sigx core **`0.14.0`**: the `catalog:` pins for `@sigx/reactivity`/`@sigx/runtime-core`/`@sigx/server-renderer`/`@sigx/vite`/`sigx` move from `^0.13.0` to `^0.14.0`, which narrows the published peer range to that single minor. No source change was needed — `verify:catalog`, `build`, `typecheck` and `test` (150 tests) all passed against 0.14.0 on the first run. (#81)

  Core 0.14 is worth reading before upgrading: it makes a reactive object's **key set** a dependency (enumeration via `Object.keys()`/`for…in`/spread/rest now re-runs a reader when a key appears or disappears), so an effect that enumerates reactive state can re-run in cases where it previously did not, and it turns host attributes on a component into an opt-in (`& Define.Attrs`). Neither affects `@sigx/store`'s own surface. See signalxjs/core's `CHANGELOG.md` for 0.14.0.

## [0.11.0] - 2026-07-23

### Changed (breaking)

- **`ssrState()` no longer consumes the transfer entry** — the seed stays in the page blob, so every store instance created in the client runtime seeds from it, each with its own structural copy. `scope: 'instance'` restores the old consume-once behaviour for state that genuinely belongs to one instance (core's `docs/seams.md` names that shape for a pack seed which must not outlive its instance). Consume-once was the wrong default the moment a document could hold several instances of one store: under `@sigx/ssr-islands` each island root is its own client component tree, and under `@sigx/resume` each separately-upgraded boundary can be — so island #2 onward hydrated from defaults (in `@sigx/i18n`: the wrong language, plus a refetch of catalogs the server had already serialized into the blob that was just discarded — repaired downstream in signalxjs/i18n#14, a repair every pack with runtime-wide state would have had to copy). It was also a divergence: core documents the blob as *"the page's DATA CACHE for its lifetime"* and `useData`, `useStream` and `@sigx/cache` all read it without consuming — `@sigx/store` was the only consuming reader in sigx. Migration: pass `scope: 'instance'` to any `ssrState()` call whose state must not be shared by a second instance. (#70)

### Changed

- `ssrState()` reads the transfer blob through core's accessors — `peekRestored` / `invalidateRestored` from `@sigx/runtime-core/internals` — instead of its own `window`/`globalThis` read. Rich values (`Date`, `Map`, `Set`, `BigInt`) in a transferred slice now round-trip, because the store finally applies the same `@sigx/serialize` codec `useData` and `@sigx/cache` apply; previously they arrived as raw tagged JSON while TypeScript still reported the declared type. The seam has one decode point again, and the windowless-client handling added in #58 moves to core, which gates those accessors on `isLiveClient()` as of 0.13 (`@sigx/server-renderer` #407) — same behaviour on lynx/terminal, no second reader of the global here. (#70)
- `ssrState()` rejects a seed that is not a plain record instead of reporting a no-op hydration. Only arrays were excluded before, so a blob entry the codec revives into a `Date`/`Map` (or a class instance from a custom type handler) passed the check, contributed no slice keys, and still returned `hydrated: true` — besides reading through an object that can carry getters or proxy traps. The check compares prototype identity and reads no property of the seed or its prototype, since a `constructor` lookup on attacker-controlled data is itself enough to fire a getter or proxy trap. **A blob entry carrying a literal `"__proto__"` key is now ignored wholesale** rather than part-applied: the codec rebuilds objects by assignment, so such an entry arrives with its own prototype swapped — a shape nothing legitimate produces (`snapshot()` skips reserved keys on the way out), which makes a tampered blob the only source. `Object.prototype` was never affected either way. (#70)

### Fixed

- **`ssrState()` dev-warns instead of silently no-op'ing when the store is first created outside component resolution** (#63). A store whose FIRST resolution happens in a router guard (`router.beforeEach`) or in the `createApp` factory via `app.runWithContext` has no current instance, so the server branch can't reach `instance.ssr._ctx`, nothing registers, the blob lacks `store:<name>` and the client starts from defaults — with nothing said anywhere. Found by signalxjs/pulse (pulse#1), where the navbar flipped to signed-out after hydration. The existing warning covered "server render context missing on an instance" but not the no-instance-at-all case, which is exactly what auth guards do. The pattern that works: request state flows through an injectable for pre-render consumers, and the store is first touched in a component's setup.

## [0.10.0] - 2026-07-23

### Changed

- Migrated to sigx core **`0.13.0`**: the `catalog:` pins for `@sigx/reactivity`/`@sigx/runtime-core`/`@sigx/server-renderer`/`@sigx/vite`/`sigx` move from `^0.12.0` to `^0.13.0`. Verified with typecheck, tests and build against 0.13.0.
- `ssrState()` now registers its live slice through the server renderer's public `ctx.registerSerializedState(key, value)` write path (`@sigx/server-renderer` #407) instead of a bare `_asyncResults.set()`. In core 0.13 the `stateSerializationPlugin` only emits keys marked in `_unflushedAsyncKeys`, which `registerSerializedState` sets and a direct `_asyncResults.set()` does not — without this migration a store's SSR state was silently dropped from the `window.__SIGX_ASYNC__` blob. The public API (`ssrState`) and its `store:<name>` transfer contract are unchanged; this restores server→client state transfer against core 0.13. The duck-typed boundary now gates on `registerSerializedState` rather than a Map-like `_asyncResults`.

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
