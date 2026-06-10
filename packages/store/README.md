# @sigx/store

Store for [SignalX](https://sigx.dev/core/) — a state management abstraction built on signals. Define stores with reactive state, computed getters, actions, and event-driven mutation tracking.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/store/>**

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

## License

[MIT](./LICENSE) © Andreas Ekdahl
