# Changelog

All notable changes to `@sigx/store`. The package also keeps a per-package `packages/store/CHANGELOG.md`.

## [Unreleased]

### Changed (breaking)

- **`@sigx/store`**: `@sigx/runtime-core` and `@sigx/reactivity` are now `peerDependencies` (`>=0.5.0 <0.7.0`) instead of regular dependencies. Regular deps could resolve a second copy of core next to the app's (e.g. app on core 0.6 + store's `^0.5.0`), silently splitting core's singleton state — the topic registry, DI app-context token, and `instanceof` identity. With peers, the app's single copy is always used. Install: `npm i @sigx/store @sigx/runtime-core @sigx/reactivity` (most apps already have core via `sigx`).

## 0.4.4 — 2026-05-12

- Bump core dependency ranges to `^0.4.3` and rebuild against core `0.4.3`. No store API changes.

## 0.4.3 — 2026-05-10

- First release published via GitHub Actions with npm provenance attestation. Functionally identical to `0.4.2`.

## 0.4.2 — 2026-05-10

- Initial release of `signalxjs/store`. Source extracted from the `viewti/lynx` incubation repo.
