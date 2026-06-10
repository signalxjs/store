# @sigx/store

Store for [SignalX](https://sigx.dev/core/) — signal-first state management with a flat, fully-typed store surface, per-action lifecycle events, atomic patches, and built-in persistence.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/store/>**

## Install

```bash
npm install @sigx/store
```

## Usage

```tsx
import { component } from 'sigx';
import { computed } from '@sigx/reactivity';
import { defineStore } from '@sigx/store';

const useTodoStore = defineStore('todos', ({ defineState, defineActions }) => {
  const { state, signals, patch } = defineState({
    todos: [] as { id: number; text: string; done: boolean }[],
    nextId: 1,
  });

  const remaining = computed(() => state.todos.filter(t => !t.done).length);

  const actions = defineActions({
    add(text: string) {
      patch(s => {
        s.todos.push({ id: s.nextId, text, done: false });
        s.nextId++;
      });
    },
    async save() {
      await api.save(state.todos);
    },
  });

  return { ...signals, ...actions, remaining };
}, 'scoped');

const Todos = component(() => {
  const store = useTodoStore();

  return () => (
    <div>
      <p>{store.remaining} left</p>                      {/* computed, unwrapped */}
      <ul>{store.todos.map(t => <li>{t.text}</li>)}</ul> {/* state, unwrapped   */}
      <button onClick={() => store.add('new')}>add</button>
      <button onClick={() => store.save()} disabled={store.save.pending}>
        {store.save.pending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
});
```

## The flat store surface

Whatever the setup returns becomes the store: returned key signals read/write as plain values, returned `computed(...)` values read as plain read-only values, actions carry `pending` and `onDispatching`/`onDispatched`/`onFailure` lifecycle events, and everything else passes through. **Public state = the key signals you return** — unreturned keys stay private. Store meta lives behind `$`: `$id`, `$patch` (atomic multi-key update), `$events` (per-key change events, watchers run only while subscribed), `$dispose`.

Two conventions to know:

- **Don't destructure the store** — `const { todos } = store` snapshots the value. Use `storeToSignals(store)` for destructuring-safe signal views.
- **Write actions as single-signature functions** (union parameters instead of overloads) so the derived event/subscriber types stay exact.

Persistence ships at the **`@sigx/store/persist`** subpath: sync/async storage (localStorage, AsyncStorage), `pick`, `version` + `migrate`, `debounce`, a reactive `hydrated` flag, and saving paused until hydration completes.

## License

[MIT](https://github.com/signalxjs/store/blob/main/LICENSE)
