/**
 * Type-level tests for the redesigned store surface.
 *
 * This file is NOT picked up by the regular `vitest run` include pattern
 * (`*.test.ts`); it matches vitest's default typecheck include
 * (`*.test-d.ts`) and is otherwise enforced by the TypeScript compiler —
 * the `it` bodies are never executed, only typechecked.
 */
import { describe, it, expectTypeOf } from 'vitest';
import { defineStore, storeToSignals, type KeySignal } from '../src/store';
import { computed, type Computed } from '@sigx/reactivity';

let storeCounter = 0;

function createTypedStore() {
    const useStore = defineStore(`typesTest_${++storeCounter}`, (ctx) => {
        const { state, signals } = ctx.defineState({
            todos: [] as string[],
            filter: 'all' as 'all' | 'done',
            secret: 0,
        });
        const total = computed(() => state.todos.length);
        const actions = ctx.defineActions({
            add: (count: number, label: string) => count + label.length,
            fetchData: async (id: number) => `data-${id}`,
        });
        return {
            // `secret` is intentionally NOT returned — it must stay private.
            todos: signals.todos,
            filter: signals.filter,
            total,
            ...actions,
            helper: (x: number) => `${x}`,
            config: { nested: true },
        };
    });
    return useStore();
}

describe('store action types', () => {
    it('action call signatures are exact (params and return, incl. Promise)', () => {
        const store = createTypedStore();

        expectTypeOf(store.add).parameters.toEqualTypeOf<[number, string]>();
        expectTypeOf(store.add).returns.toEqualTypeOf<number>();

        expectTypeOf(store.fetchData).parameters.toEqualTypeOf<[number]>();
        expectTypeOf(store.fetchData).returns.toEqualTypeOf<Promise<string>>();
    });

    it('onDispatching subscriber params equal Parameters<F>', () => {
        const store = createTypedStore();

        expectTypeOf(store.add.onDispatching.subscribe)
            .parameter(0)
            .parameters.toEqualTypeOf<[number, string]>();
        expectTypeOf(store.fetchData.onDispatching.subscribe)
            .parameter(0)
            .parameters.toEqualTypeOf<[number]>();
    });

    it('onDispatched subscriber params are (Awaited<ReturnType<F>>, ...Parameters<F>)', () => {
        const store = createTypedStore();

        expectTypeOf(store.add.onDispatched.subscribe)
            .parameter(0)
            .parameters.toEqualTypeOf<[number, number, string]>();
        // The async action's result is the RESOLVED value, not the promise.
        expectTypeOf(store.fetchData.onDispatched.subscribe)
            .parameter(0)
            .parameters.toEqualTypeOf<[string, number]>();
    });

    it('onFailure subscriber params are (unknown, ...Parameters<F>)', () => {
        const store = createTypedStore();

        expectTypeOf(store.add.onFailure.subscribe)
            .parameter(0)
            .parameters.toEqualTypeOf<[unknown, number, string]>();
        expectTypeOf(store.fetchData.onFailure.subscribe)
            .parameter(0)
            .parameters.toEqualTypeOf<[unknown, number]>();
    });

    it('pending is a boolean', () => {
        const store = createTypedStore();
        expectTypeOf(store.add.pending).toEqualTypeOf<boolean>();
    });
});

describe('flat surface types', () => {
    it('returned key signals unwrap to the state type and are writable', () => {
        const store = createTypedStore();

        expectTypeOf(store.todos).toEqualTypeOf<string[]>();
        expectTypeOf(store.filter).toEqualTypeOf<'all' | 'done'>();

        store.todos = ['a'];
        store.filter = 'done';
        // @ts-expect-error — only the declared union members are assignable
        store.filter = 'nope';
    });

    it('returned computeds unwrap to the value type and are read-only', () => {
        const store = createTypedStore();

        expectTypeOf(store.total).toEqualTypeOf<number>();
        // @ts-expect-error — computed store keys are read-only
        store.total = 1;
    });

    it('plain functions and objects keep their exact types', () => {
        const store = createTypedStore();

        expectTypeOf(store.helper).toEqualTypeOf<(x: number) => string>();
        expectTypeOf(store.config).toEqualTypeOf<{ nested: boolean }>();
    });

    it('$id is a string', () => {
        const store = createTypedStore();
        expectTypeOf(store.$id).toEqualTypeOf<string>();
    });
});

describe('$patch and $events types', () => {
    it('$patch accepts a Partial of ONLY the returned-signal keys', () => {
        const store = createTypedStore();

        store.$patch({ todos: ['a'] });
        store.$patch({ filter: 'done' });
        store.$patch({});

        // @ts-expect-error — unknown keys are rejected
        store.$patch({ nope: 1 });
        // @ts-expect-error — `secret` was never returned, so it is private
        store.$patch({ secret: 1 });
        // @ts-expect-error — computed keys are not patchable state
        store.$patch({ total: 5 });
    });

    it('$patch(fn) types the draft as the public state', () => {
        const store = createTypedStore();

        store.$patch(draft => {
            expectTypeOf(draft).toEqualTypeOf<{ todos: string[]; filter: 'all' | 'done' }>();
            draft.todos = [...draft.todos, 'x'];
        });
    });

    it('$events keys are exactly the returned-signal keys', () => {
        const store = createTypedStore();

        expectTypeOf<keyof typeof store.$events>().toEqualTypeOf<'todos' | 'filter'>();

        store.$events.todos.subscribe((value, prev) => {
            expectTypeOf(value).toEqualTypeOf<string[]>();
            expectTypeOf(prev).toEqualTypeOf<string[] | undefined>();
        });
    });
});

describe('storeToSignals types', () => {
    it('returns KeySignal-shaped values for state keys and readonly views for computeds', () => {
        type Setup = {
            todos: KeySignal<string[]>;
            total: Computed<number>;
            helper: (x: number) => string;
        };
        type Sigs = ReturnType<typeof storeToSignals<Setup>>;

        // State keys come back as writable key signals…
        expectTypeOf<Sigs['todos']>().toEqualTypeOf<KeySignal<string[]>>();
        expectTypeOf<Sigs['todos']['value']>().toEqualTypeOf<string[]>();

        // …computeds as readonly { value } views…
        expectTypeOf<Sigs['total']>().toEqualTypeOf<{ readonly value: number }>();

        // …and functions are skipped entirely.
        expectTypeOf<keyof Sigs>().toEqualTypeOf<'todos' | 'total'>();
    });
});
