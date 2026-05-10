<div align="center">

# @sigx/store

**Reactive store for [SignalX](https://github.com/signalxjs/core).**

[![npm](https://img.shields.io/npm/v/@sigx/store.svg?label=@sigx/store&color=blue)](https://www.npmjs.com/package/@sigx/store)
[![license](https://img.shields.io/npm/l/@sigx/store.svg)](./LICENSE)
[![ci](https://github.com/signalxjs/store/actions/workflows/ci.yml/badge.svg)](https://github.com/signalxjs/store/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/@sigx/store.svg)](https://www.typescriptlang.org/)

</div>

> 🚧 SignalX is in early public release (`0.4.x`). The API surface is small and stabilising — feedback is very welcome.

## Install

```bash
npm install @sigx/store
```

## Quick start

```ts
import { defineStore, defineState, defineActions } from '@sigx/store';

export const useCounter = defineStore('counter', () => {
  const state = defineState({ count: 0 });

  const actions = defineActions({
    increment() {
      state.count++;
    },
    reset() {
      state.count = 0;
    },
  });

  return { state, ...actions };
});
```

```tsx
import { component } from 'sigx';
import { useCounter } from './stores/counter';

export const Counter = component(() => {
  const counter = useCounter();
  return () => (
    <button onClick={counter.increment}>
      count: {counter.state.count}
    </button>
  );
});
```

## Features

- **Tiny surface** — `defineStore`, `defineState`, `defineActions`.
- **Reactive state** — built on `@sigx/reactivity` signals; mutate directly.
- **Type-safe** — full TS inference for state and actions.
- **No global setup** — stores are plain factory functions; instantiate where you need them.

## Companion repos

- [`signalxjs/core`](https://github.com/signalxjs/core) — `reactivity`, `runtime-core`, `runtime-dom`, `server-renderer`, `vite`, `sigx`
- [`signalxjs/router`](https://github.com/signalxjs/router) — `@sigx/router`
- [`signalxjs/ssg`](https://github.com/signalxjs/ssg) — `@sigx/ssg`, `@sigx/ssr-islands`, `@sigx/ssg-theme-daisyui`
- [`signalxjs/cli`](https://github.com/signalxjs/cli) — `@sigx/cli` (sigx-cli plugin host)
- [`signalxjs/lynx`](https://github.com/signalxjs/lynx) — Lynx native runtime + modules
- [`signalxjs/docs`](https://github.com/signalxjs/docs) — Docs site

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

## License

MIT © Andreas Ekdahl
