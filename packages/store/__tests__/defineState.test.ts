import { describe, it, expect, vi } from 'vitest';
import { defineStore } from '../src/store';

/**
 * Helper to create a store exposing the raw defineState pieces for testing.
 * Each call creates a unique factory (and store name) so instance counters
 * and scoped-lifetime fallbacks never collide between tests.
 */
let storeCounter = 0;
function createStateStore<T extends object>(initialState: T) {
    const name = `stateTest_${++storeCounter}`;
    const useStore = defineStore(name, (ctx) => {
        const { state, signals, events, patch } = ctx.defineState(initialState);
        return { state, signals, events, patch };
    });
    return useStore() as unknown as {
        state: T;
        signals: { [K in keyof T]-?: { value: T[K] } };
        events: {
            [K in keyof T]-?: {
                subscribe(fn: (value: T[K], prev: T[K] | undefined) => void): { unsubscribe(): void };
            };
        };
        patch: {
            (partial: Partial<T>): void;
            (mutator: (state: T) => void): void;
        };
    };
}

describe('defineState', () => {
    it('returns state, signals, events, and patch', () => {
        const store = createStateStore({ count: 0, label: 'hello' });
        expect(store.state).toBeDefined();
        expect(store.signals).toBeDefined();
        expect(store.events).toBeDefined();
        expect(typeof store.patch).toBe('function');
    });

    it('state is reactive and mutable directly', () => {
        const store = createStateStore({ count: 0 });
        expect(store.state.count).toBe(0);
        store.state.count = 10;
        expect(store.state.count).toBe(10);
    });

    it('signals read and write through to the state', () => {
        const store = createStateStore({ count: 0, label: 'a' });

        expect(store.signals.count.value).toBe(0);
        expect(store.signals.label.value).toBe('a');

        store.signals.count.value = 7;
        expect(store.state.count).toBe(7);

        store.state.label = 'b';
        expect(store.signals.label.value).toBe('b');
    });

    it('writing through a key signal fires the key event', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        store.events.count.subscribe(spy);

        store.signals.count.value = 3;
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(3, 0);
    });
});

describe('per-key events (lazy refCount)', () => {
    it('subscribing does not fire immediately', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        store.events.count.subscribe(spy);
        expect(spy).not.toHaveBeenCalled();
    });

    it('mutations before any subscriber emit nothing — the watcher does not exist yet', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();

        // Nobody is listening: this mutation is not recorded anywhere.
        store.state.count = 5;

        store.events.count.subscribe(spy);
        expect(spy).not.toHaveBeenCalled();

        store.state.count = 6;
        expect(spy).toHaveBeenCalledTimes(1);
        // prev is 5 (the value when the watcher STARTED at first subscribe),
        // not 0 — proof that no watcher existed before the first subscriber.
        expect(spy).toHaveBeenCalledWith(6, 5);
    });

    it('fires with (value, prev) for primitive keys', () => {
        const store = createStateStore({ count: 0, label: 'a' });
        const countSpy = vi.fn();
        const labelSpy = vi.fn();
        store.events.count.subscribe(countSpy);
        store.events.label.subscribe(labelSpy);

        store.state.count = 1;
        expect(countSpy).toHaveBeenCalledWith(1, 0);
        expect(labelSpy).not.toHaveBeenCalled();

        store.state.label = 'b';
        expect(labelSpy).toHaveBeenCalledWith('b', 'a');
        expect(countSpy).toHaveBeenCalledTimes(1);
    });

    it('deep object mutation fires the key event', () => {
        const store = createStateStore({ user: { name: 'Alice', tags: ['a'] } });
        const spy = vi.fn();
        store.events.user.subscribe(spy);

        store.state.user.name = 'Bob';

        expect(spy).toHaveBeenCalledTimes(1);
        const [value, prev] = spy.mock.calls[0];
        expect(value.name).toBe('Bob');
        // The deep watcher observes the SAME live object: value and prev are
        // the same reference (prev is pinned to the current object, not a
        // pre-mutation snapshot).
        expect(prev).toBe(value);
    });

    it('multiple subscribers on one key each receive events', () => {
        const store = createStateStore({ count: 0 });
        const spy1 = vi.fn();
        const spy2 = vi.fn();
        const sub1 = store.events.count.subscribe(spy1);
        store.events.count.subscribe(spy2);

        store.state.count = 1;
        expect(spy1).toHaveBeenCalledWith(1, 0);
        expect(spy2).toHaveBeenCalledWith(1, 0);

        // Unsubscribing one subscriber leaves the other active.
        sub1.unsubscribe();
        store.state.count = 2;
        expect(spy1).toHaveBeenCalledTimes(1);
        expect(spy2).toHaveBeenCalledTimes(2);
        expect(spy2).toHaveBeenLastCalledWith(2, 1);
    });

    it('unsubscribe stops events', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        const sub = store.events.count.subscribe(spy);

        store.state.count = 1;
        expect(spy).toHaveBeenCalledTimes(1);

        sub.unsubscribe();
        store.state.count = 2;
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('the watcher stops after the last unsubscribe and restarts on resubscribe', () => {
        const store = createStateStore({ count: 0 });
        const spy = vi.fn();
        const sub = store.events.count.subscribe(spy);

        store.state.count = 1;
        expect(spy).toHaveBeenCalledTimes(1);

        sub.unsubscribe();
        store.state.count = 2;
        // Watcher stopped with the last subscriber — nothing recorded.
        expect(spy).toHaveBeenCalledTimes(1);

        const spy2 = vi.fn();
        store.events.count.subscribe(spy2);
        expect(spy2).not.toHaveBeenCalled();

        store.state.count = 3;
        expect(spy2).toHaveBeenCalledTimes(1);
        // prev is 2 (the value when the watcher restarted), proving the
        // watcher was actually gone while nobody was subscribed.
        expect(spy2).toHaveBeenCalledWith(3, 2);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('patch', () => {
    it('patch(partial) updates multiple keys', () => {
        const store = createStateStore({ a: 0, b: 0, c: 'x' });
        store.patch({ a: 1, b: 2 });
        expect(store.state.a).toBe(1);
        expect(store.state.b).toBe(2);
        expect(store.state.c).toBe('x');
    });

    it('patch(partial) is atomic — each key event fires exactly once with the final value', () => {
        const store = createStateStore({ a: 0, b: 0 });
        const spyA = vi.fn();
        const spyB = vi.fn();
        store.events.a.subscribe(spyA);
        store.events.b.subscribe(spyB);

        store.patch({ a: 1, b: 2 });

        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyA).toHaveBeenCalledWith(1, 0);
        expect(spyB).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledWith(2, 0);
    });

    it('patch(mutator) batches multiple writes to one key into a single event', () => {
        const store = createStateStore({ a: 0 });
        const spy = vi.fn();
        store.events.a.subscribe(spy);

        store.patch(s => {
            s.a = 1;
            s.a = 2;
        });

        expect(store.state.a).toBe(2);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(2, 0);
    });

    it('patch(mutator) errors propagate and writes before the throw persist', () => {
        const store = createStateStore({ a: 0, b: 0 });

        expect(() =>
            store.patch(s => {
                s.a = 1;
                throw new Error('patch boom');
            })
        ).toThrow('patch boom');

        expect(store.state.a).toBe(1);
        expect(store.state.b).toBe(0);
    });
});
