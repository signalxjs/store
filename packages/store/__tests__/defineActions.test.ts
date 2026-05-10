import { describe, it, expect, vi } from 'vitest';
import { defineStore } from '../src/store';

/**
 * Helper to create a store with actions for testing.
 * Each call creates a unique factory to avoid singleton conflicts.
 */
let storeCounter = 0;
function createActionStore<TActions extends Record<string, (...args: any[]) => any>>(
    actions: TActions
) {
    const name = `actionTest_${++storeCounter}`;
    const useStore = defineStore(name, (ctx) => {
        const wrappedActions = ctx.defineActions(actions);
        return { actions: wrappedActions } as any;
    });
    return useStore() as {
        actions: TActions & {
            onDispatching: { [K in keyof TActions]: { subscribe: (fn: (...args: any[]) => void) => { unsubscribe: () => void } } };
            onDispatched: { [K in keyof TActions]: { subscribe: (fn: (...args: any[]) => void) => { unsubscribe: () => void } } };
            onFailure: { [K in keyof TActions]: { subscribe: (fn: (...args: any[]) => void) => { unsubscribe: () => void } } };
        };
        dispose: () => void;
        name: string;
    };
}

describe('defineActions', () => {
    it('actions are callable functions', () => {
        const store = createActionStore({
            increment: () => {},
            greet: (_name: string) => {},
        });
        expect(typeof store.actions.increment).toBe('function');
        expect(typeof store.actions.greet).toBe('function');
    });

    it('actions execute the original function', () => {
        const originalFn = vi.fn();
        const store = createActionStore({
            doWork: originalFn,
        });
        store.actions.doWork();
        expect(originalFn).toHaveBeenCalled();
    });

    it('actions pass arguments to the original function', () => {
        const originalFn = vi.fn();
        const store = createActionStore({
            doWork: originalFn,
        });
        store.actions.doWork('a', 42, true);
        expect(originalFn).toHaveBeenCalledWith('a', 42, true);
    });

    it('actions return the original function return value', () => {
        const store = createActionStore({
            add: (a: number, b: number) => a + b,
            greet: (name: string) => `Hello ${name}`,
        });
        expect(store.actions.add(2, 3)).toBe(5);
        expect(store.actions.greet('World')).toBe('Hello World');
    });

    it('onDispatching fires before action executes', () => {
        const order: string[] = [];
        const store = createActionStore({
            doSomething: () => {
                order.push('action');
                return 42;
            },
        });

        store.actions.onDispatching.doSomething.subscribe(() => {
            order.push('dispatching');
        });

        store.actions.doSomething();
        expect(order[0]).toBe('dispatching');
        expect(order[1]).toBe('action');
    });

    it('onDispatching subscriber receives the action arguments', () => {
        const store = createActionStore({
            greet: (_name: string, _age: number) => 'done',
        });
        const spy = vi.fn();
        store.actions.onDispatching.greet.subscribe(spy);

        store.actions.greet('Alice', 30);
        expect(spy).toHaveBeenCalledWith('Alice', 30);
    });

    it('onDispatched fires after synchronous action with result and args', () => {
        const store = createActionStore({
            add: (a: number, b: number) => a + b,
        });
        const spy = vi.fn();
        store.actions.onDispatched.add.subscribe(spy);

        store.actions.add(3, 7);
        expect(spy).toHaveBeenCalledWith(10, 3, 7);
    });

    it('onDispatched fires in correct order relative to action execution', () => {
        const order: string[] = [];
        const store = createActionStore({
            doSomething: () => {
                order.push('action');
                return 'result';
            },
        });

        store.actions.onDispatching.doSomething.subscribe(() => order.push('dispatching'));
        store.actions.onDispatched.doSomething.subscribe(() => order.push('dispatched'));

        store.actions.doSomething();
        expect(order).toEqual(['dispatching', 'action', 'dispatched']);
    });

    it('onDispatched fires after async action resolves', async () => {
        const store = createActionStore({
            fetchData: async () => 'data',
        });
        const spy = vi.fn();
        store.actions.onDispatched.fetchData.subscribe(spy);

        const promise = store.actions.fetchData();

        // onDispatched should not have fired yet (async)
        expect(spy).not.toHaveBeenCalled();

        // Wait for promise to resolve and .then to fire
        await promise;
        await Promise.resolve();

        expect(spy).toHaveBeenCalled();
    });

    it('onFailure fires when action throws', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const error = new Error('boom');
        const store = createActionStore({
            failing: () => { throw error; },
        });
        const spy = vi.fn();
        store.actions.onFailure.failing.subscribe(spy);

        store.actions.failing();

        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0]).toBe(error);
        consoleSpy.mockRestore();
    });

    it('onFailure receives the error and action arguments', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const error = new Error('fail');
        const store = createActionStore({
            failing: (_x: number, _y: string) => { throw error; },
        });
        const spy = vi.fn();
        store.actions.onFailure.failing.subscribe(spy);

        store.actions.failing(42, 'test');

        expect(spy).toHaveBeenCalledWith(error, 42, 'test');
        consoleSpy.mockRestore();
    });

    it('onFailure logs the error to console.error', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = createActionStore({
            failing: () => { throw new Error('logged error'); },
        });

        store.actions.failing();

        expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
        consoleSpy.mockRestore();
    });

    it('throwing action returns undefined', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = createActionStore({
            failing: (): number => { throw new Error('fail'); },
        });

        const result = store.actions.failing();
        expect(result).toBeUndefined();
        consoleSpy.mockRestore();
    });

    it('multiple actions each get independent events', () => {
        const store = createActionStore({
            actionA: () => 'A',
            actionB: () => 'B',
        });
        const spyA = vi.fn();
        const spyB = vi.fn();

        store.actions.onDispatched.actionA.subscribe(spyA);
        store.actions.onDispatched.actionB.subscribe(spyB);

        store.actions.actionA();
        expect(spyA).toHaveBeenCalledWith('A');
        expect(spyB).not.toHaveBeenCalled();

        store.actions.actionB();
        expect(spyB).toHaveBeenCalledWith('B');
        expect(spyA).toHaveBeenCalledTimes(1); // still only called once
    });

    it('subscription returns a Subscription object with unsubscribe', () => {
        const store = createActionStore({
            doWork: () => {},
        });

        const sub = store.actions.onDispatching.doWork.subscribe(() => {});
        expect(sub).toBeDefined();
        expect(typeof sub.unsubscribe).toBe('function');
    });

    it('event subscription cleanup via unsubscribe', () => {
        const store = createActionStore({
            doWork: () => 'result',
        });
        const spy = vi.fn();
        const sub = store.actions.onDispatched.doWork.subscribe(spy);

        store.actions.doWork();
        expect(spy).toHaveBeenCalledTimes(1);

        sub.unsubscribe();
        spy.mockClear();

        store.actions.doWork();
        expect(spy).not.toHaveBeenCalled();
    });

    it('onDispatching, onDispatched, and onFailure objects exist on actions result', () => {
        const store = createActionStore({
            myAction: () => {},
        });
        expect(store.actions.onDispatching).toBeDefined();
        expect(store.actions.onDispatched).toBeDefined();
        expect(store.actions.onFailure).toBeDefined();
        expect(store.actions.onDispatching.myAction).toBeDefined();
        expect(store.actions.onDispatched.myAction).toBeDefined();
        expect(store.actions.onFailure.myAction).toBeDefined();
    });
});
