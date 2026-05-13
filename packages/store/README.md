# @sigx/store

Store for [SignalX](https://github.com/signalxjs/core) — a state management abstraction built on signals. Define stores with reactive state, computed getters, actions, and event-driven mutation tracking.

## Install

```bash
npm install @sigx/store
```

## Usage

```tsx
import { component } from 'sigx';
import { defineStore, useStore } from '@sigx/store';

const useCounterStore = defineStore('counter', ({ defineState, defineActions }) => {
  const state = defineState({ count: 0 });

  const actions = defineActions({
    increment() {
      state.count++;
    },
    decrement() {
      state.count--;
    },
  });

  return { state, actions };
});

const Counter = component(() => {
  const store = useStore(useCounterStore);

  return () => (
    <div>
      <p>Count: {store.state.count}</p>
      <button onClick={store.actions.increment}>+</button>
      <button onClick={store.actions.decrement}>-</button>
    </div>
  );
});
```

## Key Exports

| Export | Description |
|---|---|
| `defineStore(name, setup)` | Define a new store with reactive state and actions |
| `useStore(store)` | Access a store instance within a component |

### Setup Context

The setup function receives a context with:

- **`defineState(initial)`** — Creates reactive state with automatic mutation events
- **`defineActions(actions)`** — Wraps action functions with lifecycle events (`onDispatching`, `onDispatched`, `onFailure`)

## Documentation

Full SignalX documentation: <https://signalxjs.github.io/>.

## License

[MIT](./LICENSE) © Andreas Ekdahl
