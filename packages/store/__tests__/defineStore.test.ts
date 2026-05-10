import { describe, it, expect, vi } from 'vitest';
import { defineStore } from '../src/store';

describe('defineStore', () => {
    it('returns a factory function', () => {
        const useStore = defineStore('test', () => {
            return {};
        });
        expect(typeof useStore).toBe('function');
    });

    it('calling the factory creates a store instance with a generated name', () => {
        const useStore = defineStore('myStore', (ctx) => {
            const { state } = ctx.defineState({ count: 0 });
            return { state };
        });
        const store = useStore();
        expect(store).toBeDefined();
        expect(store.state).toBeDefined();
        expect(store.state!.count).toBe(0);
        expect(store.name).toBeDefined();
    });

    it('store name follows {name}_{guid} format', () => {
        const useStore = defineStore('counterStore', () => {
            return {};
        });
        const store = useStore();
        expect(store.name).toBeDefined();
        expect(store.name).toMatch(/^counterStore_/);
        const guidPart = store.name!.replace('counterStore_', '');
        expect(guidPart).toMatch(
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
        );
    });

    it('store setup receives defineState and defineActions on context', () => {
        let receivedCtx: any = null;
        const useStore = defineStore('ctxTest', (ctx) => {
            receivedCtx = ctx;
            return {};
        });
        useStore();
        expect(receivedCtx).not.toBeNull();
        expect(typeof receivedCtx.defineState).toBe('function');
        expect(typeof receivedCtx.defineActions).toBe('function');
    });

    it('setup context also receives onDeactivated and subscriptions from factory context', () => {
        let receivedCtx: any = null;
        const useStore = defineStore('ctxFull', (ctx) => {
            receivedCtx = ctx;
            return {};
        });
        useStore();
        expect(typeof receivedCtx.onDeactivated).toBe('function');
        expect(receivedCtx.subscriptions).toBeDefined();
    });

    it('custom name in setup return overrides generated name', () => {
        const useStore = defineStore('base', () => {
            return { name: 'myCustomName' };
        });
        const store = useStore();
        expect(store.name).toBe('myCustomName');
    });

    it('store with no state or actions (minimal)', () => {
        const useStore = defineStore('minimal', () => {
            return {};
        });
        const store = useStore();
        expect(store).toBeDefined();
        expect(store.name).toMatch(/^minimal_/);
    });

    it('onDeactivated cleans up effectScope and topics', () => {
        const useStore = defineStore('cleanup', (ctx) => {
            const { state, events } = ctx.defineState({ count: 0 });
            return { state, events };
        });
        const store = useStore() as any;

        const spy = vi.fn();
        store.events.onMutatedCount.subscribe(spy);

        // Before dispose, events should fire
        store.state.count = 1;
        expect(spy).toHaveBeenCalledWith(1);
        spy.mockClear();

        // Dispose the store
        store.dispose();

        // After dispose, topics are destroyed and scope is stopped
        // Events should no longer fire
        store.state.count = 2;
        expect(spy).not.toHaveBeenCalled();
    });
});
