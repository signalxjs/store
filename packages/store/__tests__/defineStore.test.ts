import { describe, it, expect, vi } from 'vitest';
import { defineStore, storeToSignals } from '../src/store';
import { computed } from '@sigx/reactivity';

/** Unique store name per test — instance ids count per name. */
let storeCounter = 0;
const nextName = () => `storeTest_${++storeCounter}`;

describe('flat store surface', () => {
    it('returned key signals unwrap: state reads and writes as plain values', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0, todos: [] as string[] });
            return { ...signals };
        });
        const store = useStore();

        expect(store.count).toBe(0);
        expect(store.todos).toEqual([]);

        store.count = 5;
        expect(store.count).toBe(5);

        store.todos = [...store.todos, 'first'];
        expect(store.todos).toEqual(['first']);
    });

    it('returned computeds unwrap read-only and assignment throws', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { state, signals } = ctx.defineState({ count: 2 });
            const doubled = computed(() => state.count * 2);
            return { ...signals, doubled };
        });
        const store = useStore();

        expect(store.doubled).toBe(4);
        store.count = 5;
        expect(store.doubled).toBe(10);

        expect(() => {
            (store as any).doubled = 99;
        }).toThrow(/read-only/);
        expect(store.doubled).toBe(10);
    });

    it('plain functions and objects pass through unchanged', () => {
        const config = { nested: true };
        const useStore = defineStore(nextName(), (ctx) => {
            const { state, signals } = ctx.defineState({ count: 1 });
            return {
                ...signals,
                addTen: () => state.count + 10,
                config,
            };
        });
        const store = useStore();

        expect(typeof store.addTen).toBe('function');
        expect(store.addTen()).toBe(11);
        expect(store.config).toBe(config);

        store.count = 5;
        expect(store.addTen()).toBe(15);
    });

    it('accessor getters in the setup return stay live', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { state, signals } = ctx.defineState({ count: 0 });
            return {
                ...signals,
                get parity() {
                    return state.count % 2 === 0 ? 'even' : 'odd';
                },
            };
        });
        const store = useStore();

        expect(store.parity).toBe('even');
        store.count = 3;
        expect(store.parity).toBe('odd');
    });

    it('a key signal returned under a different name maps that public key', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ todos: ['a'] });
            return { items: signals.todos };
        });
        const store = useStore();

        expect(store.items).toEqual(['a']);
        const spy = vi.fn();
        store.$events.items.subscribe(spy);

        store.$patch({ items: ['a', 'b'] });
        expect(store.items).toEqual(['a', 'b']);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Object.keys and spread show user keys only — no $-meta', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { state, signals } = ctx.defineState({ count: 1 });
            const doubled = computed(() => state.count * 2);
            return { ...signals, doubled, helper: () => 0 };
        });
        const store = useStore();

        const keys = Object.keys(store);
        expect(keys).toEqual(expect.arrayContaining(['count', 'doubled', 'helper']));
        expect(keys.some(key => key.startsWith('$'))).toBe(false);

        const spread = { ...store } as Record<string, unknown>;
        expect(spread.count).toBe(1); // unwrapped through the get trap
        expect(spread.doubled).toBe(2);
        expect(spread.$id).toBeUndefined();
        expect(spread.$patch).toBeUndefined();
    });
});

describe('store meta', () => {
    it('$id has the name#N format', () => {
        const name = nextName();
        const useStore = defineStore(name, () => ({}));
        const store = useStore();
        expect(store.$id).toBe(`${name}#1`);
    });

    it('instance ids increment per name', () => {
        const name = nextName();
        const useStore = defineStore(name, (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        }, 'transient');

        expect(useStore().$id).toBe(`${name}#1`);
        expect(useStore().$id).toBe(`${name}#2`);
    });

    it('$patch(partial) updates atomically — one event per key with the final value', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ a: 0, b: 0 });
            return { ...signals };
        });
        const store = useStore();
        const spyA = vi.fn();
        const spyB = vi.fn();
        store.$events.a.subscribe(spyA);
        store.$events.b.subscribe(spyB);

        store.$patch({ a: 1, b: 2 });

        expect(store.a).toBe(1);
        expect(store.b).toBe(2);
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyA).toHaveBeenCalledWith(1, 0);
        expect(spyB).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledWith(2, 0);
    });

    it('$patch(partial) throws on an unknown key', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ a: 0 });
            return { ...signals };
        });
        const store = useStore();

        expect(() => store.$patch({ nope: 1 } as any)).toThrow(/unknown state key "nope"/);
    });

    it('$patch(fn) routes draft reads and writes to the public keys', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 10 });
            return { ...signals };
        });
        const store = useStore();
        const spy = vi.fn();
        store.$events.count.subscribe(spy);

        store.$patch(draft => {
            draft.count = draft.count + 5;
        });

        expect(store.count).toBe(15);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(15, 10);
    });

    it('$patch(fn) throws when the draft touches an unknown key', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        });
        const store = useStore();

        expect(() =>
            store.$patch((draft: any) => {
                draft.nope = 1;
            })
        ).toThrow(/no state key "nope"/);
    });

    it('$events expose per-key change events for the returned keys', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        });
        const store = useStore();
        const spy = vi.fn();
        store.$events.count.subscribe(spy);

        store.count = 7;
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(7, 0);
    });

    it('signals NOT returned from setup stay private', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0, secret: 'hidden' });
            return { count: signals.count };
        });
        const store = useStore();

        expect((store as any).secret).toBeUndefined();
        expect(Object.keys(store.$events)).toEqual(['count']);
        expect((store.$events as any).secret).toBeUndefined();
        expect(() => store.$patch({ secret: 'leak' } as any)).toThrow(/unknown state key "secret"/);
    });

    it('assigning any $-prefixed key throws', () => {
        const useStore = defineStore(nextName(), () => ({}));
        const store = useStore();

        expect(() => {
            (store as any).$id = 'other';
        }).toThrow(/store meta/);
        expect(() => {
            (store as any).$anything = 1;
        }).toThrow(/store meta/);
    });

    it('$dispose() stops watchers and destroys the key-event topics', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        });
        const store = useStore();
        const spy = vi.fn();
        store.$events.count.subscribe(spy);

        store.count = 1;
        expect(spy).toHaveBeenCalledTimes(1);

        store.$dispose();

        // Watchers are stopped: mutations no longer notify old subscribers.
        store.count = 2;
        expect(spy).toHaveBeenCalledTimes(1);

        // The topic is destroyed: subscribing after dispose throws.
        expect(() => store.$events.count.subscribe(() => {})).toThrow();
    });
});

describe('setup contract', () => {
    it('setup returning a non-object throws', () => {
        const useNull = defineStore(nextName(), () => null as any);
        expect(() => useNull()).toThrow(/must return an object/);

        const useNumber = defineStore(nextName(), () => 42 as any);
        expect(() => useNumber()).toThrow(/must return an object/);
    });

    it('setup receives storeName and instanceId on the context', () => {
        const name = nextName();
        let seenName: string | undefined;
        let seenInstanceId: string | undefined;
        const useStore = defineStore(name, (ctx) => {
            seenName = ctx.storeName;
            seenInstanceId = ctx.instanceId;
            return {};
        });
        useStore();

        expect(seenName).toBe(name);
        expect(seenInstanceId).toBe(`${name}#1`);
    });

    it('setup context exposes the factory context members', () => {
        let seenCtx: any;
        const useStore = defineStore(nextName(), (ctx) => {
            seenCtx = ctx;
            return {};
        });
        useStore();

        expect(typeof seenCtx.defineState).toBe('function');
        expect(typeof seenCtx.defineActions).toBe('function');
        expect(typeof seenCtx.defineEvents).toBe('function');
        expect(typeof seenCtx.onDeactivated).toBe('function');
        expect(seenCtx.subscriptions).toBeDefined();
    });

    it('defineEvents creates typed topics that publish and subscribe', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const events = ctx.defineEvents<{ notify: string; counted: number }>();
            return { events };
        });
        const store = useStore();

        const notifySpy = vi.fn();
        const countedSpy = vi.fn();
        store.events.notify.subscribe(notifySpy);
        store.events.counted.subscribe(countedSpy);

        store.events.notify.publish('hello');
        expect(notifySpy).toHaveBeenCalledWith('hello');
        expect(countedSpy).not.toHaveBeenCalled();

        store.events.counted.publish(7);
        expect(countedSpy).toHaveBeenCalledWith(7);
        expect(notifySpy).toHaveBeenCalledTimes(1);
    });

    it('defineEvents topics are destroyed with the store', () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const events = ctx.defineEvents<{ notify: string }>();
            return { events };
        });
        const store = useStore();

        store.$dispose();
        expect(() => store.events.notify.subscribe(() => {})).toThrow();
    });

    it("lifetime 'transient' gives a fresh, independent instance per call", () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        }, 'transient');

        const a = useStore();
        const b = useStore();

        expect(a.$id).not.toBe(b.$id);
        a.count = 5;
        expect(a.count).toBe(5);
        expect(b.count).toBe(0);
    });

    it("lifetime 'scoped' outside any app context returns the same instance per factory", () => {
        const useStore = defineStore(nextName(), (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        });

        const a = useStore();
        const b = useStore();
        expect(a.$id).toBe(b.$id);
        a.count = 9;
        expect(b.count).toBe(9);
    });
});

describe('storeToSignals', () => {
    function createStore() {
        const useStore = defineStore(nextName(), (ctx) => {
            const { state, signals } = ctx.defineState({ count: 0 });
            const doubled = computed(() => state.count * 2);
            return { ...signals, doubled, helper: () => 0 };
        });
        return useStore();
    }

    it('returns key signals that stay reactive for read AND write', () => {
        const store = createStore();
        const sigs = storeToSignals(store as any) as any;

        expect(sigs.count.value).toBe(0);

        sigs.count.value = 3;
        expect(store.count).toBe(3);

        store.count = 4;
        expect(sigs.count.value).toBe(4);
    });

    it('returns read-only live views for computeds', () => {
        const store = createStore();
        const sigs = storeToSignals(store as any) as any;

        expect(sigs.doubled.value).toBe(0);
        store.count = 5;
        expect(sigs.doubled.value).toBe(10);

        // The view has a getter only — assigning throws in strict mode.
        expect(() => {
            sigs.doubled.value = 99;
        }).toThrow(TypeError);
    });

    it('skips functions', () => {
        const store = createStore();
        const sigs = storeToSignals(store as any) as any;

        expect('helper' in sigs).toBe(false);
        expect(Object.keys(sigs).sort()).toEqual(['count', 'doubled']);
    });

    it('throws on non-store input', () => {
        expect(() => storeToSignals({} as any)).toThrow(/storeToSignals expects a store/);
        expect(() => storeToSignals({ count: 1 } as any)).toThrow(/storeToSignals expects a store/);
    });
});
