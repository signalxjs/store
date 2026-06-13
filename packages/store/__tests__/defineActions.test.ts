import { describe, it, expect, vi } from 'vitest';
import { effect } from '@sigx/reactivity';
import { defineStore } from '../src/store';

/**
 * Helper to create a store whose flat surface IS the wrapped actions.
 * Each call creates a unique factory name to avoid singleton conflicts.
 */
let storeCounter = 0;
function createActionStore<TActions extends Record<string, (...args: any[]) => any>>(
    actions: TActions
) {
    const name = `actionTest_${++storeCounter}`;
    const useStore = defineStore(name, (ctx) => ({ ...ctx.defineActions(actions) }));
    return useStore();
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Pinned semantics from signalxjs/store#20: resolved values (not promises) in
// onDispatched, async rejections reach onFailure, sync errors propagate.
describe('action event semantics (#20)', () => {
    it('onDispatched receives the RESOLVED value of an async action, not the promise', async () => {
        const store = createActionStore({
            fetchData: async () => 'data',
        });

        const results: unknown[] = [];
        store.fetchData.onDispatched.subscribe((result) => {
            results.push(result);
        });

        await store.fetchData();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(results).toEqual(['data']);
    });

    it('onFailure fires when an async action rejects', async () => {
        const failure = vi.fn();
        const store = createActionStore({
            fetchData: async () => {
                throw new Error('network down');
            },
        });

        store.fetchData.onFailure.subscribe(failure);

        await expect(store.fetchData()).rejects.toThrow('network down');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(failure).toHaveBeenCalled();
        expect(failure.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('sync action errors propagate to the caller', () => {
        const store = createActionStore({
            failing: () => {
                throw new Error('boom');
            },
        });

        expect(() => store.failing()).toThrow('boom');
    });
});

describe('defineActions', () => {
    it('actions are callable functions on the flat store surface', () => {
        const store = createActionStore({
            increment: () => {},
            greet: (_name: string) => {},
        });
        expect(typeof store.increment).toBe('function');
        expect(typeof store.greet).toBe('function');
    });

    it('actions execute the original function', () => {
        const originalFn = vi.fn();
        const store = createActionStore({
            doWork: originalFn,
        });
        store.doWork();
        expect(originalFn).toHaveBeenCalled();
    });

    it('actions pass arguments to the original function', () => {
        const originalFn = vi.fn();
        const store = createActionStore({
            doWork: originalFn,
        });
        store.doWork('a', 42, true);
        expect(originalFn).toHaveBeenCalledWith('a', 42, true);
    });

    it('actions return the original function return value', () => {
        const store = createActionStore({
            add: (a: number, b: number) => a + b,
            greet: (name: string) => `Hello ${name}`,
        });
        expect(store.add(2, 3)).toBe(5);
        expect(store.greet('World')).toBe('Hello World');
    });

    it('an async action returns the ORIGINAL promise from the action body', async () => {
        const d = deferred<string>();
        const store = createActionStore({
            load: () => d.promise,
        });

        const returned = store.load();
        expect(returned).toBe(d.promise);

        d.resolve('ok');
        await expect(returned).resolves.toBe('ok');
    });

    it('actions do not require a `this` binding', () => {
        const store = createActionStore({
            add: (a: number, b: number) => a + b,
        });
        const { add } = store;
        expect(add(2, 3)).toBe(5);
    });

    it('onDispatching fires before the action executes', () => {
        const order: string[] = [];
        const store = createActionStore({
            doSomething: () => {
                order.push('action');
                return 42;
            },
        });

        store.doSomething.onDispatching.subscribe(() => {
            order.push('dispatching');
        });

        store.doSomething();
        expect(order).toEqual(['dispatching', 'action']);
    });

    it('onDispatching subscriber receives the action arguments', () => {
        const store = createActionStore({
            greet: (_name: string, _age: number) => 'done',
        });
        const spy = vi.fn();
        store.greet.onDispatching.subscribe(spy);

        store.greet('Alice', 30);
        expect(spy).toHaveBeenCalledWith('Alice', 30);
    });

    it('onDispatched fires after a synchronous action with (result, ...args)', () => {
        const store = createActionStore({
            add: (a: number, b: number) => a + b,
        });
        const spy = vi.fn();
        store.add.onDispatched.subscribe(spy);

        store.add(3, 7);
        expect(spy).toHaveBeenCalledWith(10, 3, 7);
    });

    it('events fire in dispatching → action → dispatched order', () => {
        const order: string[] = [];
        const store = createActionStore({
            doSomething: () => {
                order.push('action');
                return 'result';
            },
        });

        store.doSomething.onDispatching.subscribe(() => order.push('dispatching'));
        store.doSomething.onDispatched.subscribe(() => order.push('dispatched'));

        store.doSomething();
        expect(order).toEqual(['dispatching', 'action', 'dispatched']);
    });

    it('onDispatched fires only after an async action resolves, with (resolvedValue, ...args)', async () => {
        const store = createActionStore({
            fetchData: async (id: number) => `data-${id}`,
        });
        const spy = vi.fn();
        store.fetchData.onDispatched.subscribe(spy);

        const promise = store.fetchData(7);

        // Async: must not have fired synchronously.
        expect(spy).not.toHaveBeenCalled();

        await promise;
        await Promise.resolve();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('data-7', 7);
    });

    it('sync errors publish onFailure with (error, ...args) and then re-throw', () => {
        const error = new Error('fail');
        const store = createActionStore({
            failing: (_x: number, _y: string) => {
                throw error;
            },
        });
        const spy = vi.fn();
        store.failing.onFailure.subscribe(spy);

        expect(() => store.failing(42, 'test')).toThrow('fail');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(error, 42, 'test');
    });

    it('async rejections publish onFailure with (error, ...args)', async () => {
        const error = new Error('async fail');
        const store = createActionStore({
            failing: async (_id: number) => {
                throw error;
            },
        });
        const spy = vi.fn();
        store.failing.onFailure.subscribe(spy);

        await expect(store.failing(9)).rejects.toThrow('async fail');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(error, 9);
    });

    it('a fire-and-forget rejected action does not produce an unhandled rejection', async () => {
        const failure = vi.fn();
        const store = createActionStore({
            fireAndForget: async () => {
                throw new Error('ignored by the caller');
            },
        });
        store.fireAndForget.onFailure.subscribe(failure);

        // Intentionally NOT awaited and NOT caught — the handled side chain
        // inside the wrapper must absorb the rejection. If it did not, vitest
        // would fail this test with an unhandled rejection.
        void store.fireAndForget();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(failure).toHaveBeenCalledTimes(1);
    });

    it('multiple actions each get independent event streams', () => {
        const store = createActionStore({
            actionA: () => 'A',
            actionB: () => 'B',
        });
        const spyA = vi.fn();
        const spyB = vi.fn();

        store.actionA.onDispatched.subscribe(spyA);
        store.actionB.onDispatched.subscribe(spyB);

        store.actionA();
        expect(spyA).toHaveBeenCalledWith('A');
        expect(spyB).not.toHaveBeenCalled();

        store.actionB();
        expect(spyB).toHaveBeenCalledWith('B');
        expect(spyA).toHaveBeenCalledTimes(1); // still only called once
    });

    it('subscribe returns a Subscription object with unsubscribe', () => {
        const store = createActionStore({
            doWork: () => {},
        });

        const sub = store.doWork.onDispatching.subscribe(() => {});
        expect(sub).toBeDefined();
        expect(typeof sub.unsubscribe).toBe('function');
    });

    it('unsubscribe stops further event deliveries', () => {
        const store = createActionStore({
            doWork: () => 'result',
        });
        const spy = vi.fn();
        const sub = store.doWork.onDispatched.subscribe(spy);

        store.doWork();
        expect(spy).toHaveBeenCalledTimes(1);

        sub.unsubscribe();
        spy.mockClear();

        store.doWork();
        expect(spy).not.toHaveBeenCalled();
    });

    it('onDispatching, onDispatched, and onFailure exist on every action', () => {
        const store = createActionStore({
            myAction: () => {},
        });
        expect(store.myAction.onDispatching).toBeDefined();
        expect(store.myAction.onDispatched).toBeDefined();
        expect(store.myAction.onFailure).toBeDefined();
    });
});

// Regression for signalxjs/store#42: the wrapper's bookkeeping (inflight
// counter, lifecycle-topic reads/publishes) must run UNTRACKED. Calling an
// action inside a reactive context (a component render, an effect) must not
// subscribe that context to the wrapper's internals — otherwise the settle
// write re-triggers the context, which calls the action again: an infinite
// loop at microtask speed. The action BODY stays tracked: its reads are the
// caller's legitimate dependencies.
describe('action bookkeeping is untracked (#42)', () => {
    it('an effect calling a sync action does not re-run when the bookkeeping settles', () => {
        const store = createActionStore({
            getValue: () => 42,
        });

        let runs = 0;
        const runner = effect(() => {
            runs++;
            if (runs > 5) return; // safety valve: bounds the loop on regression
            store.getValue();
        });

        expect(runs).toBe(1);
        runner.stop();
    });

    it('two effects calling the same sync action do not re-trigger each other (render ping-pong)', () => {
        // Two components rendering the same getter-action: on buggy code,
        // effect A subscribes to `inflight` via the `++` read, then effect
        // B's `++`/`--` writes re-trigger A, whose writes re-trigger B — a
        // synchronous infinite ping-pong (the page-freeze shape for sync
        // actions; self-triggers alone are skipped by the effect runtime).
        const store = createActionStore({
            getValue: () => 42,
        });

        let runsA = 0;
        let runsB = 0;
        const runnerA = effect(() => {
            runsA++;
            if (runsA > 5) return; // safety valve: bounds the loop on regression
            store.getValue();
        });
        const runnerB = effect(() => {
            runsB++;
            if (runsB > 5) return; // safety valve: bounds the loop on regression
            store.getValue();
        });

        expect(runsA).toBe(1);
        expect(runsB).toBe(1);
        runnerA.stop();
        runnerB.stop();
    });

    it('a scheduler-driven (renderer-style) effect calling a sync action is never re-scheduled', async () => {
        // Renderers drive re-renders through the effect `scheduler` option,
        // which is notified for ANY trigger — including the wrapper's own
        // `inflight` writes during the render itself. This is the exact
        // page-freeze shape: render → action → bookkeeping write →
        // re-scheduled render → action → … at microtask speed.
        const store = createActionStore({
            getValue: () => 42,
        });

        let runs = 0;
        let scheduled = 0;
        const runner = effect(
            () => {
                runs++;
                store.getValue();
            },
            {
                scheduler: (run) => {
                    scheduled++;
                    if (scheduled > 10) return; // safety valve: bounds the loop on regression
                    queueMicrotask(run);
                },
            }
        );

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(scheduled).toBe(0);
        expect(runs).toBe(1);
        runner.stop();
    });

    it('a scheduler-driven effect calling a sync action with lifecycle subscribers is never re-scheduled', async () => {
        const store = createActionStore({
            work: (x: number) => x * 2,
        });
        const order: string[] = [];
        store.work.onDispatching.subscribe((x) => order.push(`dispatching:${x}`));
        store.work.onDispatched.subscribe((result) => order.push(`dispatched:${result}`));

        let runs = 0;
        let scheduled = 0;
        const runner = effect(
            () => {
                runs++;
                store.work(21);
            },
            {
                scheduler: (run) => {
                    scheduled++;
                    if (scheduled > 10) return; // safety valve: bounds the loop on regression
                    queueMicrotask(run);
                },
            }
        );

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(scheduled).toBe(0);
        expect(runs).toBe(1);
        expect(order).toEqual(['dispatching:21', 'dispatched:42']);
        runner.stop();
    });

    it('an effect calling an async action does not re-run when the action settles', async () => {
        const d = deferred<string>();
        const store = createActionStore({
            load: () => d.promise,
        });

        let runs = 0;
        const runner = effect(() => {
            runs++;
            if (runs > 5) return; // safety valve: bounds the loop on regression
            void store.load();
        });

        expect(runs).toBe(1);

        d.resolve('ok');
        await d.promise;
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(runs).toBe(1);
        runner.stop();
    });

    it('an effect calling an action with lifecycle subscribers does not re-run, and the events still fire', () => {
        const order: string[] = [];
        const store = createActionStore({
            work: (x: number) => x * 2,
        });
        store.work.onDispatching.subscribe((x) => order.push(`dispatching:${x}`));
        store.work.onDispatched.subscribe((result) => order.push(`dispatched:${result}`));

        let runs = 0;
        const runner = effect(() => {
            runs++;
            if (runs > 5) return; // safety valve: bounds the loop on regression
            store.work(21);
        });

        expect(runs).toBe(1);
        expect(order).toEqual(['dispatching:21', 'dispatched:42']);
        runner.stop();
    });

    it('an effect calling a sync-throwing action does not re-run, and onFailure still fires', () => {
        const failure = vi.fn();
        const store = createActionStore({
            failing: () => {
                throw new Error('boom');
            },
        });
        store.failing.onFailure.subscribe(failure);

        let runs = 0;
        const runner = effect(() => {
            runs++;
            if (runs > 5) return; // safety valve: bounds the loop on regression
            try {
                store.failing();
            } catch {
                // swallowed: the loop under test is reactive, not exceptional
            }
        });

        expect(runs).toBe(1);
        expect(failure).toHaveBeenCalledTimes(1);
        runner.stop();
    });

    it('an effect calling an async-rejecting action does not re-run, and onFailure still fires', async () => {
        const d = deferred<string>();
        const store = createActionStore({
            load: () => d.promise,
        });
        const failure = vi.fn();
        store.load.onFailure.subscribe(failure);

        let runs = 0;
        const runner = effect(() => {
            runs++;
            if (runs > 5) return; // safety valve: bounds the loop on regression
            store.load().catch(() => {});
        });

        expect(runs).toBe(1);

        d.reject(new Error('nope'));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(runs).toBe(1);
        expect(failure).toHaveBeenCalledTimes(1);
        runner.stop();
    });

    it('.pending stays reactive: an effect reading it re-runs on pending transitions', async () => {
        const d = deferred<string>();
        const store = createActionStore({
            load: () => d.promise,
        });

        const seen: boolean[] = [];
        const runner = effect(() => {
            seen.push(store.load.pending);
        });
        expect(seen).toEqual([false]);

        const promise = store.load();
        expect(seen).toEqual([false, true]);

        d.resolve('done');
        await promise;
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(seen).toEqual([false, true, false]);
        runner.stop();
    });
});

describe('action pending', () => {
    it('is false before, true during, and false after an async action resolves', async () => {
        const d = deferred<string>();
        const store = createActionStore({
            load: () => d.promise,
        });

        expect(store.load.pending).toBe(false);

        const promise = store.load();
        expect(store.load.pending).toBe(true);

        d.resolve('done');
        await promise;
        expect(store.load.pending).toBe(false);
    });

    it('is false again after an async action rejects', async () => {
        const d = deferred<string>();
        const store = createActionStore({
            load: () => d.promise,
        });

        const promise = store.load();
        expect(store.load.pending).toBe(true);

        d.reject(new Error('nope'));
        await expect(promise).rejects.toThrow('nope');
        expect(store.load.pending).toBe(false);
    });

    it('stays true while ANY overlapping invocation is still in flight', async () => {
        const d1 = deferred<string>();
        const d2 = deferred<string>();
        const store = createActionStore({
            load: (p: Promise<string>) => p,
        });

        const p1 = store.load(d1.promise);
        const p2 = store.load(d2.promise);
        expect(store.load.pending).toBe(true);

        d1.resolve('first');
        await p1;
        expect(store.load.pending).toBe(true); // second call still in flight

        d2.resolve('second');
        await p2;
        expect(store.load.pending).toBe(false);
    });

    it('sync actions are never observably pending after the call', () => {
        let pendingDuring: boolean | undefined;
        // Indirection avoids a circular type-inference on `store`.
        let readPending: () => boolean = () => false;
        const store = createActionStore({
            work: () => {
                pendingDuring = readPending();
                return 1;
            },
        });
        readPending = () => store.work.pending;

        expect(store.work.pending).toBe(false);
        store.work();
        expect(pendingDuring).toBe(true); // in flight while the body runs
        expect(store.work.pending).toBe(false);
    });

    it('is false after a sync action throws', () => {
        const store = createActionStore({
            failing: () => {
                throw new Error('boom');
            },
        });

        expect(() => store.failing()).toThrow('boom');
        expect(store.failing.pending).toBe(false);
    });
});
