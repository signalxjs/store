import { describe, it, expect, vi } from 'vitest';
import { defineStore } from '../src/store';

/**
 * Helper to create a store with state for testing.
 * Each call creates a unique factory to avoid singleton conflicts.
 */
let storeCounter = 0;
function createStateStore<T extends object>(initialState: T) {
    const name = `stateTest_${++storeCounter}`;
    const useStore = defineStore(name, (ctx) => {
        const { state, events, mutate } = ctx.defineState(initialState);
        return { state, events, mutate } as any;
    });
    return useStore() as {
        state: T;
        events: any;
        mutate: { [K in keyof T]: (value: T[K] | ((prev: T[K]) => T[K])) => void };
        dispose: () => void;
        name: string;
    };
}

describe('defineState', () => {
    it('returns state, events, and mutate objects', () => {
        const store = createStateStore({ count: 0, label: 'hello' });
        expect(store.state).toBeDefined();
        expect(store.events).toBeDefined();
        expect(store.mutate).toBeDefined();
    });

    it('state is reactive (signal-based)', () => {
        const store = createStateStore({ count: 0 });
        expect(store.state.count).toBe(0);
        store.state.count = 10 as any;
        expect(store.state.count).toBe(10);
    });

    it('state properties can be read and written directly', () => {
        const store = createStateStore({ name: 'Alice', age: 30 });
        expect(store.state.name).toBe('Alice');
        expect(store.state.age).toBe(30);

        store.state.name = 'Bob' as any;
        store.state.age = 25 as any;
        expect(store.state.name).toBe('Bob');
        expect(store.state.age).toBe(25);
    });

    it('mutate[key](value) updates the state property', () => {
        const store = createStateStore({ count: 0, text: 'hello' });

        store.mutate.count(42);
        expect(store.state.count).toBe(42);

        store.mutate.text('world' as any);
        expect(store.state.text).toBe('world');
    });

    it('mutate[key](fn) calls the function with current value and updates', () => {
        const store = createStateStore({ count: 10 });

        store.mutate.count(((prev: number) => prev + 5) as any);
        expect(store.state.count).toBe(15);

        store.mutate.count(((prev: number) => prev * 2) as any);
        expect(store.state.count).toBe(30);
    });

    it('mutate catches and logs errors from updater functions', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = createStateStore({ count: 0 });

        store.mutate.count((() => {
            throw new Error('updater error');
        }) as any);

        expect(consoleSpy).toHaveBeenCalled();
        expect(store.state.count).toBe(0); // state unchanged
        consoleSpy.mockRestore();
    });

    it('each state property has an onMutated{Key} event', () => {
        const store = createStateStore({ count: 0, name: 'test' });

        expect(store.events.onMutatedCount).toBeDefined();
        expect(typeof store.events.onMutatedCount.subscribe).toBe('function');
        expect(store.events.onMutatedName).toBeDefined();
        expect(typeof store.events.onMutatedName.subscribe).toBe('function');
    });

    it('mutation events fire when state changes via mutate', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        store.events.onMutatedCount.subscribe(spy);

        store.mutate.count(5);
        expect(spy).toHaveBeenCalledWith(5);
    });

    it('mutation events fire when state changes via direct assignment', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        store.events.onMutatedCount.subscribe(spy);

        store.state.count = 7 as any;
        expect(spy).toHaveBeenCalledWith(7);
    });

    it('event subscribers receive the new value', () => {
        const store = createStateStore({ text: 'initial' });
        const values: string[] = [];

        store.events.onMutatedText.subscribe((val: string) => {
            values.push(val);
        });

        store.mutate.text('first' as any);
        store.mutate.text('second' as any);

        expect(values).toContain('first');
        expect(values).toContain('second');
    });

    it('multiple subscribers on the same event all get notified', () => {
        const store = createStateStore({ count: 0 });
        const spy1 = vi.fn();
        const spy2 = vi.fn();

        store.events.onMutatedCount.subscribe(spy1);
        store.events.onMutatedCount.subscribe(spy2);

        store.mutate.count(99);
        expect(spy1).toHaveBeenCalledWith(99);
        expect(spy2).toHaveBeenCalledWith(99);
    });

    it('deep watch triggers events on nested object changes', () => {
        const store = createStateStore({ user: { name: 'Alice', age: 30 } });
        const spy = vi.fn();
        store.events.onMutatedUser.subscribe(spy);

        store.state.user.name = 'Bob' as any;

        expect(spy).toHaveBeenCalled();
        const receivedUser = spy.mock.calls[spy.mock.calls.length - 1][0];
        expect(receivedUser.name).toBe('Bob');
    });

    it('unsubscribing from an event prevents further notifications', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        const sub = store.events.onMutatedCount.subscribe(spy);

        store.mutate.count(1);
        expect(spy).toHaveBeenCalledTimes(1);

        sub.unsubscribe();
        spy.mockClear();

        store.mutate.count(2);
        expect(spy).not.toHaveBeenCalled();
    });
});
