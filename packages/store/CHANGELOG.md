# Changelog

All notable changes to `@sigx/store` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
