import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineStore, onStoreCreated, type StorePluginContext } from '../src/store';

/** Unique store name per test — instance ids count per name. */
let storeCounter = 0;
const nextName = () => `pluginTest_${++storeCounter}`;

// onStoreCreated registers into a GLOBAL set — always clean up so plugins
// from one test never observe stores created by another.
const subscriptions: { unsubscribe(): void }[] = [];
function register(plugin: (ctx: StorePluginContext) => void) {
    const sub = onStoreCreated(plugin);
    subscriptions.push(sub);
    return sub;
}
afterEach(() => {
    while (subscriptions.length) {
        subscriptions.pop()!.unsubscribe();
    }
});

describe('onStoreCreated', () => {
    it('fires per instance with the name, instanceId, and the RAW setup return', () => {
        const seen: StorePluginContext[] = [];
        register(ctx => seen.push(ctx));

        const name = nextName();
        const useStore = defineStore(name, (ctx) => {
            const { signals } = ctx.defineState({ count: 1 });
            return { ...signals };
        }, 'transient');

        const store = useStore();
        expect(seen).toHaveLength(1);
        expect(seen[0].name).toBe(name);
        expect(seen[0].instanceId).toBe(`${name}#1`);

        // The plugin sees the raw setup return: the key signal itself
        // ({ value } accessor object), NOT the unwrapped proxy view.
        const raw = seen[0].instance as { count: { value: number } };
        expect(typeof raw.count).toBe('object');
        expect(raw.count.value).toBe(1);
        expect(store.count).toBe(1);

        // A second instance fires the plugin again with the next id.
        useStore();
        expect(seen).toHaveLength(2);
        expect(seen[1].instanceId).toBe(`${name}#2`);
    });

    it('plugins run in registration order', () => {
        const order: string[] = [];
        register(() => order.push('first'));
        register(() => order.push('second'));

        defineStore(nextName(), () => ({}))();

        expect(order).toEqual(['first', 'second']);
    });

    it('unsubscribe stops future invocations', () => {
        const spy = vi.fn();
        const sub = register(spy);

        defineStore(nextName(), () => ({}))();
        expect(spy).toHaveBeenCalledTimes(1);

        sub.unsubscribe();

        defineStore(nextName(), () => ({}))();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('onDeactivated from the plugin context runs when the store is disposed', () => {
        const cleanup = vi.fn();
        register(ctx => ctx.onDeactivated(cleanup));

        const store = defineStore(nextName(), () => ({}))();
        expect(cleanup).not.toHaveBeenCalled();

        store.$dispose();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('a throwing plugin is isolated: logged, later plugins run, store creation unaffected', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const after = vi.fn();
        register(() => {
            throw new Error('plugin boom');
        });
        register(after);

        const name = nextName();
        const useStore = defineStore(name, (ctx) => {
            const { signals } = ctx.defineState({ count: 0 });
            return { ...signals };
        });

        const store = useStore();

        // Store creation succeeded and the store works.
        expect(store.$id).toBe(`${name}#1`);
        expect(store.count).toBe(0);
        store.count = 2;
        expect(store.count).toBe(2);

        // The plugin after the throwing one still ran.
        expect(after).toHaveBeenCalledTimes(1);

        // The failure was reported, not swallowed silently.
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('onStoreCreated'),
            expect.any(Error)
        );
        consoleSpy.mockRestore();
    });
});
