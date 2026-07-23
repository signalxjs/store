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

## Actions in renders

Calling an action from a render (or any reactive context) is safe with respect to the wrapper itself: the action wrapper's internal bookkeeping (the `pending` counter, lifecycle-event plumbing) runs untracked, so merely *calling* an action never subscribes the render to the wrapper's internals. Reads inside the action **body** stay tracked on purpose — a getter-style action read in a render keeps the render reactive to the state it reads — and reading `action.pending` is an intentional subscription.

What still loops — by design — is an action whose body **writes** reactive state when called from a render closure: the write is a real state change, the render re-runs, calls the action again, writes again. Don't resolve or fetch data by calling a writing action during render; do it in `watch`/`onMounted` (or an event handler) and let the render just read the store state:

```tsx
const Profile = component(() => {
  const store = useUserStore();
  onMounted(() => store.fetchUser(id));      // writes happen here…
  return () => <p>{store.user?.name}</p>;    // …the render only reads
});
```

## Server-side rendering

`ssrState()` transfers a store's state from the server render to client
hydration — fetch/compute once on the server, never refetch in the browser:

```ts
import { defineStore } from '@sigx/store';
import { ssrState } from '@sigx/store/ssr';

const useCart = defineStore('cart', (ctx) => {
    const { state, signals, patch } = ctx.defineState({ items: [] as string[], total: 0 });
    ssrState(ctx, { state, patch });          // ← one line
    return { ...signals };
});
```

- **Server**: the slice serializes into the page's `window.__SIGX_ASYNC__`
  blob under `store:cart` — emitted automatically by `renderDocument`
  (or `createSSR({ plugins: [stateSerializationPlugin()] })`). Serialization
  happens at emit time, so state mutated during the request ships with final
  values, and a store first resolved below a streamed boundary ships in that
  boundary's chunk rather than being dropped.
- **Client**: the store seeds from the blob as one atomic `patch()`, and the
  entry **stays** — every instance of the store created in that client runtime
  seeds from it, each with its own structural copy. Returns `{ hydrated }` if
  you need to know. Rich values (`Date`, `Map`, `Set`, `BigInt`) round-trip:
  the read goes through core's blob accessors, so store seeds get the same
  codec `useData` and `@sigx/cache` do. (The per-instance copy uses
  `structuredClone`, which preserves them. On a runtime without it, a value
  JSON cannot represent exactly is shared by reference rather than flattened —
  with a dev warning, since a mutation in one instance would then reach the
  others.)
- `pick: ['items']` limits which keys cross the wire.
- `scope: 'instance'` makes the seed consume-once instead — a later instance
  starts from defaults. Use it when the transferred state belongs to one store
  instance rather than to the runtime as a whole. The default (`'shared'`) is
  what a locale + catalogs, a theme, a session or a feature-flag set wants:
  under `@sigx/ssr-islands` each island root is its own client component tree,
  and under `@sigx/resume` each separately-upgraded boundary can be — with
  consume-once, everything after the first hydrates from defaults.
- Composes with `persist()`: call `ssrState` first — persist's hydration
  then overrides with device-local data when present.

Requires `sigx`/`@sigx/server-renderer` on the `0.13.x` core line on the
server — matching the single core minor this package pins for
`@sigx/reactivity`/`@sigx/runtime-core` in its `peerDependencies` (`^0.13.0`);
the sigx framework moves together, one minor at a time. This module itself has
no server-renderer dependency — pure stores stay pure.

## License

[MIT](https://github.com/signalxjs/store/blob/main/LICENSE)
