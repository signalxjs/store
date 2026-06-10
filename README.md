<div align="center">

# @sigx/store

**Reactive store for [SignalX](https://sigx.dev/core/).**

[![npm](https://img.shields.io/npm/v/@sigx/store.svg?label=@sigx/store&color=blue)](https://www.npmjs.com/package/@sigx/store)
[![license](https://img.shields.io/npm/l/@sigx/store.svg)](./LICENSE)
[![ci](https://github.com/signalxjs/store/actions/workflows/ci.yml/badge.svg)](https://github.com/signalxjs/store/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/@sigx/store.svg)](https://www.typescriptlang.org/)

</div>

> 🚧 SignalX is in early public release (`0.4.x`). The API surface is small and stabilising — feedback is very welcome.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/store/>**

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

## Part of SignalX

- [`core`](https://sigx.dev/core/) — `reactivity`, `runtime-core`, `runtime-dom`, `server-renderer`, `vite`, `sigx`
- [`router`](https://sigx.dev/router/) — `@sigx/router`
- [`ssg`](https://sigx.dev/ssg/) — `@sigx/ssg`, `@sigx/ssr-islands`, `@sigx/ssg-theme-daisyui`
- [`cli`](https://sigx.dev/cli/) — `@sigx/cli` (sigx-cli plugin host)
- [`lynx`](https://sigx.dev/lynx/) — Lynx native runtime + modules
- [Docs site](https://sigx.dev/) — main SignalX documentation

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

## License

MIT © Andreas Ekdahl
