import {
    createTopic,
    createTopicGroup,
    defineFactory,
    type Lifetime,
    type SetupFactoryContext,
    type Subscription,
    type Topic
} from "@sigx/runtime-core";
import { batch, signal, untrack, watch, type Computed, type WatchHandle, isComputed } from "@sigx/reactivity";

// ============================================================================
// Branding & internal wiring symbols
// ============================================================================

/** Runtime brand for key signals (also drives UnwrapStore at the type level). */
const KeySignalBrand = Symbol('sigx:keySignal');
/** Phantom type carrier so storeToSignals can infer TReturn from a store. */
declare const StoreShape: unique symbol;
/** Internal: the slice a key signal reads/writes. */
const KeySlice = Symbol('sigx:keySlice');
/** Internal: the source key inside that slice. */
const KeyName = Symbol('sigx:keyName');
/** Internal: store proxy → internals, for storeToSignals. */
const storeInternals = new WeakMap<object, StoreInternals>();

// ============================================================================
// Public types
// ============================================================================

/**
 * A signal-shaped, spreadable view over one state key. Spread the `signals`
 * from defineState into your setup return to make those keys public state.
 */
export type KeySignal<T> = {
    value: T;
    readonly [KeySignalBrand]: true;
};

export type StateKeyEvent<T> = {
    subscribe(fn: (value: T, prev: T | undefined) => void): Subscription;
};

export type Patch<TState extends object> = {
    (partial: Partial<TState>): void;
    (mutator: (state: TState) => void): void;
};

/**
 * A wrapped store action: callable with the exact original signature, plus a
 * reactive in-flight flag and per-action lifecycle event subscribers.
 */
export type StoreAction<F extends (...args: any[]) => any> = F & {
    /** Reactive: true while any invocation of this action is in flight. */
    readonly pending: boolean;
    onDispatching: { subscribe(fn: (...args: Parameters<F>) => void): Subscription };
    onDispatched: { subscribe(fn: (result: Awaited<ReturnType<F>>, ...args: Parameters<F>) => void): Subscription };
    onFailure: { subscribe(fn: (error: unknown, ...args: Parameters<F>) => void): Subscription };
};

export type StoreActions<T extends Record<string, (...args: any[]) => any>> = {
    [K in keyof T]: StoreAction<T[K]>;
};

export interface SetupStoreContext extends SetupFactoryContext {
    /** The logical store name passed to defineStore (e.g. `'todos'`). */
    readonly storeName: string;
    /** The friendly instance id (e.g. `'todos#1'`). */
    readonly instanceId: string;
    defineState<TState extends object>(state: TState): {
        /** The deep reactive proxy — mutate freely inside the setup/actions. */
        state: TState;
        /** Spreadable per-key signals; the ones you return become public state. */
        signals: { [K in keyof TState]-?: KeySignal<TState[K]> };
        /** Per-key change events (lazy: watchers run only while subscribed). */
        events: { [K in keyof TState]-?: StateKeyEvent<TState[K]> };
        /** Atomic multi-key update; flushes reactivity once. Errors propagate. */
        patch: Patch<TState>;
    };
    defineActions<TActions extends Record<string, (...args: any[]) => any>>(actions: TActions): StoreActions<TActions>;
    /** Typed custom events; namespaced `${$id}.events`, destroyed with the store. */
    defineEvents<EventMap extends Record<string, any>>(): { [K in keyof EventMap]: Topic<EventMap[K]> };
}

/** The keys of the setup return that are key signals — the store's public state. */
export type PublicState<TReturn> = {
    [K in keyof TReturn as TReturn[K] extends KeySignal<any> ? K : never]:
        TReturn[K] extends KeySignal<infer V> ? V : never;
};

export type StoreMeta<TReturn extends object> = {
    /** Phantom (never set at runtime) — carries the setup return type for inference. */
    readonly [StoreShape]?: TReturn;
    /** Friendly instance id, e.g. `'todos#1'`. */
    readonly $id: string;
    /** Atomic update across the store's public state keys. */
    $patch: Patch<PublicState<TReturn>>;
    /** Per-key change events for the public state keys. */
    $events: { [K in keyof PublicState<TReturn>]: StateKeyEvent<PublicState<TReturn>[K]> };
    $dispose(): void;
};

/**
 * The flat store surface: key signals read/write as plain values, computeds
 * read as plain values (read-only), actions/functions/objects pass through,
 * `$`-meta on the side.
 */
export type UnwrapStore<TReturn extends object> =
    {
        [K in keyof TReturn as TReturn[K] extends KeySignal<any> ? K : never]:
            TReturn[K] extends KeySignal<infer V> ? V : never;
    } &
    {
        readonly [K in keyof TReturn as TReturn[K] extends KeySignal<any> ? never
            : TReturn[K] extends Computed<any> ? K : never]:
            TReturn[K] extends Computed<infer V> ? V : never;
    } &
    {
        [K in keyof TReturn as TReturn[K] extends KeySignal<any> | Computed<any> ? never : K]: TReturn[K];
    } &
    StoreMeta<TReturn>;

export type StorePluginContext = {
    /** The logical store name passed to defineStore. */
    name: string;
    /** The instance id, e.g. `'todos#1'`. */
    instanceId: string;
    /** The raw setup return (any shape — duck-type as needed). */
    instance: object;
    /** Tie plugin resources to the store instance's lifetime. */
    onDeactivated(fn: () => void): void;
};

// ============================================================================
// Internals
// ============================================================================

type Slice = {
    state: Record<string, unknown>;
    events: Record<string, StateKeyEvent<unknown>>;
};

type StoreInternals = {
    id: string;
    target: Record<string | symbol, unknown>;
    /** public key (as returned) → owning slice + source key */
    publicKeys: Map<string, { slice: Slice; sourceKey: string }>;
};

function isKeySignal(value: unknown): value is KeySignal<unknown> & { [KeySlice]: Slice; [KeyName]: string } {
    return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[KeySignalBrand] === true;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
    return typeof (value as { then?: unknown } | null)?.then === 'function';
}

// ============================================================================
// defineState
// ============================================================================

function makeState<TState extends object>(
    initial: TState,
    storeId: string,
    topics: Topic<unknown>[]
) {
    const state = signal(initial) as TState;
    const slice: Slice = { state: state as Record<string, unknown>, events: {} };
    const signals = {} as { [K in keyof TState]-?: KeySignal<TState[K]> };

    for (const key of Object.keys(initial)) {
        // Topic created eagerly (devtools-discoverable via the registry);
        // the deep watcher only runs while someone is subscribed (refCount).
        let handle: WatchHandle | null = null;
        const topic = createTopic<{ value: unknown; prev: unknown }>({
            namespace: `${storeId}.state`,
            name: key,
            onActivate: () => {
                handle = watch(
                    () => (state as Record<string, unknown>)[key],
                    (value, prev) => topic.publish({ value, prev }),
                    { deep: true }
                );
            },
            onDeactivate: () => {
                handle?.stop();
                handle = null;
            }
        });
        topics.push(topic as Topic<unknown>);

        slice.events[key] = {
            subscribe: (fn: (value: unknown, prev: unknown) => void) =>
                topic.subscribe(message => fn(message.value, message.prev))
        };

        const keySignal = {
            get value() {
                return (state as Record<string, unknown>)[key];
            },
            set value(newValue: unknown) {
                (state as Record<string, unknown>)[key] = newValue;
            }
        };
        Object.defineProperties(keySignal, {
            [KeySignalBrand]: { value: true },
            [KeySlice]: { value: slice },
            [KeyName]: { value: key }
        });
        (signals as Record<string, unknown>)[key] = keySignal;
    }

    const patch: Patch<TState> = (update: Partial<TState> | ((s: TState) => void)) => {
        batch(() => {
            if (typeof update === 'function') {
                update(state);
            } else {
                Object.assign(state, update);
            }
        });
    };

    return {
        state,
        signals,
        events: slice.events as { [K in keyof TState]-?: StateKeyEvent<TState[K]> },
        patch
    };
}

// ============================================================================
// defineActions
// ============================================================================

function makeActions<TActions extends Record<string, (...args: any[]) => any>>(
    actions: TActions,
    storeId: string,
    topics: Topic<unknown>[]
): StoreActions<TActions> {
    const result = {} as StoreActions<TActions>;
    const namespace = `${storeId}.actions`;

    for (const actionName of Object.keys(actions) as (keyof TActions & string)[]) {
        const original = actions[actionName];
        const inflight = signal({ count: 0 });

        const dispatching = createTopic<unknown[]>({ namespace, name: `${actionName}.onDispatching` });
        const dispatched = createTopic<{ result: unknown; args: unknown[] }>({ namespace, name: `${actionName}.onDispatched` });
        const failure = createTopic<{ error: unknown; args: unknown[] }>({ namespace, name: `${actionName}.onFailure` });
        topics.push(dispatching as Topic<unknown>, dispatched as Topic<unknown>, failure as Topic<unknown>);

        const wrapped = function (this: unknown, ...args: unknown[]) {
            // ALL wrapper bookkeeping runs untracked (#42): the `++` below is a
            // read-modify-write on a reactive signal, and topics are
            // signal-backed too — executed in the CALLER's tracking context,
            // those reads would subscribe a calling render/effect to the
            // wrapper's internals, and the settle write would re-trigger it
            // (→ infinite re-run loop). Only `original.apply` stays tracked:
            // reads in the action body are the caller's legitimate
            // dependencies. Writes inside untrack still notify intentional
            // subscribers (`.pending` readers, lifecycle topics).
            untrack(() => {
                if (dispatching.hasSubscribers) {
                    dispatching.publish(args);
                }
                inflight.count++;
            });

            let returned: unknown;
            try {
                returned = original.apply(this, args);
            } catch (err) {
                untrack(() => {
                    inflight.count--;
                    if (failure.hasSubscribers) {
                        failure.publish({ error: err, args });
                    }
                });
                // Errors are the caller's to handle — never swallowed.
                throw err;
            }

            if (isPromiseLike(returned)) {
                // Side chain: publishes the RESOLVED value and settles
                // pending; the ORIGINAL promise is returned so the caller
                // still observes rejection, while this handled side chain
                // prevents unhandled-rejection noise for fire-and-forget.
                // Handler bodies are guarded too: a synchronously-throwing
                // reactive effect on `pending` must not poison the chain.
                returned.then(
                    resolved => {
                        try {
                            untrack(() => {
                                inflight.count--;
                                if (dispatched.hasSubscribers) {
                                    dispatched.publish({ result: resolved, args });
                                }
                            });
                        } catch (err) {
                            if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                                console.error(`[@sigx/store] ${storeId}: error settling action "${actionName}":`, err);
                            } else {
                                console.error(err);
                            }
                        }
                    },
                    err => {
                        try {
                            untrack(() => {
                                inflight.count--;
                                if (failure.hasSubscribers) {
                                    failure.publish({ error: err, args });
                                }
                            });
                        } catch (settleErr) {
                            if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                                console.error(`[@sigx/store] ${storeId}: error settling action "${actionName}":`, settleErr);
                            } else {
                                console.error(settleErr);
                            }
                        }
                    }
                );
            } else {
                untrack(() => {
                    inflight.count--;
                    if (dispatched.hasSubscribers) {
                        dispatched.publish({ result: returned, args });
                    }
                });
            }

            return returned;
        };

        Object.defineProperties(wrapped, {
            pending: {
                get: () => inflight.count > 0,
                enumerable: false
            },
            onDispatching: {
                value: {
                    subscribe: (fn: (...args: unknown[]) => void) =>
                        dispatching.subscribe(args => fn(...args))
                },
                enumerable: false
            },
            onDispatched: {
                value: {
                    subscribe: (fn: (result: unknown, ...args: unknown[]) => void) =>
                        dispatched.subscribe(message => fn(message.result, ...message.args))
                },
                enumerable: false
            },
            onFailure: {
                value: {
                    subscribe: (fn: (error: unknown, ...args: unknown[]) => void) =>
                        failure.subscribe(message => fn(message.error, ...message.args))
                },
                enumerable: false
            }
        });

        (result as Record<string, unknown>)[actionName] = wrapped;
    }

    return result;
}

// ============================================================================
// Store proxy (the flat surface)
// ============================================================================

function buildStoreProxy(target: Record<string | symbol, unknown>, id: string): object {
    // Map returned key-signal data properties to their slices. Accessor
    // getters are deliberately NOT evaluated here — only data props checked.
    const publicKeys = new Map<string, { slice: Slice; sourceKey: string }>();
    const descriptors = Object.getOwnPropertyDescriptors(target);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if ('value' in descriptor && isKeySignal(descriptor.value)) {
            publicKeys.set(key, {
                slice: descriptor.value[KeySlice],
                sourceKey: descriptor.value[KeyName]
            });
        }
    }

    // Key signals returned via accessors (e.g. `get todos() { return signals.todos }`)
    // aren't visible as data properties — resolve them lazily on first
    // $patch/$events access so runtime behavior matches the type contract.
    const resolveKey = (key: string) => {
        let mapping = publicKeys.get(key);
        if (!mapping) {
            const value = Reflect.get(target, key);
            if (isKeySignal(value)) {
                mapping = { slice: value[KeySlice], sourceKey: value[KeyName] };
                publicKeys.set(key, mapping);
            }
        }
        return mapping;
    };

    const events = new Proxy({} as Record<string, StateKeyEvent<unknown>>, {
        get(_t, key) {
            if (typeof key !== 'string') return undefined;
            const mapping = resolveKey(key);
            return mapping ? mapping.slice.events[mapping.sourceKey] : undefined;
        },
        has: (_t, key) => typeof key === 'string' && resolveKey(key) !== undefined,
        ownKeys: () => Array.from(publicKeys.keys()),
        getOwnPropertyDescriptor: (_t, key) =>
            typeof key === 'string' && resolveKey(key)
                ? { enumerable: true, configurable: true }
                : undefined
    });

    // Draft for the $patch function form: reads/writes route to slices.
    const publicDraft = new Proxy({} as Record<string, unknown>, {
        get(_t, key) {
            if (typeof key !== 'string') return undefined;
            const mapping = resolveKey(key);
            if (!mapping) {
                throw new Error(`[@sigx/store] ${id}: $patch draft has no state key "${key}".`);
            }
            return mapping.slice.state[mapping.sourceKey];
        },
        set(_t, key, value) {
            if (typeof key !== 'string') return false;
            const mapping = resolveKey(key);
            if (!mapping) {
                throw new Error(`[@sigx/store] ${id}: $patch draft has no state key "${key}".`);
            }
            mapping.slice.state[mapping.sourceKey] = value;
            return true;
        },
        has: (_t, key) => typeof key === 'string' && resolveKey(key) !== undefined,
        ownKeys: () => Array.from(publicKeys.keys()),
        getOwnPropertyDescriptor: (_t, key) =>
            typeof key === 'string' && resolveKey(key)
                ? { enumerable: true, configurable: true, writable: true, value: undefined }
                : undefined
    });

    const $patch = (update: Record<string, unknown> | ((draft: Record<string, unknown>) => void)) => {
        batch(() => {
            if (typeof update === 'function') {
                update(publicDraft);
            } else {
                for (const [key, value] of Object.entries(update)) {
                    const mapping = resolveKey(key);
                    if (!mapping) {
                        throw new Error(`[@sigx/store] ${id}: $patch received unknown state key "${key}".`);
                    }
                    mapping.slice.state[mapping.sourceKey] = value;
                }
            }
        });
    };

    const store = new Proxy(target, {
        get(t, key, receiver) {
            switch (key) {
                case '$id': return id;
                case '$patch': return $patch;
                case '$events': return events;
                case '$dispose': return () => (t as { dispose?: () => void }).dispose?.();
            }
            const value = Reflect.get(t, key, receiver);
            if (isKeySignal(value)) {
                return value.value;
            }
            if (isComputed(value)) {
                return (value as Computed<unknown>).value;
            }
            return value;
        },
        set(t, key, value, receiver) {
            if (typeof key === 'string' && key.startsWith('$')) {
                throw new Error(`[@sigx/store] ${id}: "${key}" is store meta and cannot be assigned.`);
            }
            const current = Reflect.get(t, key, receiver);
            if (isKeySignal(current)) {
                current.value = value;
                return true;
            }
            if (isComputed(current)) {
                throw new Error(`[@sigx/store] ${id}: "${String(key)}" is a computed value and is read-only.`);
            }
            return Reflect.set(t, key, value, receiver);
        }
        // has/ownKeys/getOwnPropertyDescriptor intentionally forward to the
        // target: spread and Object.keys see user keys, never $-meta.
    });

    storeInternals.set(store, { id, target, publicKeys });
    return store;
}

// ============================================================================
// Global plugin hook
// ============================================================================

const storePlugins = new Set<(ctx: StorePluginContext) => void>();

/**
 * Register a plugin that runs for every store instance, synchronously after
 * its setup returns. Plugins run in registration order; a throwing plugin is
 * isolated and cannot break store creation. Returns a Subscription whose
 * unsubscribe stops future invocations.
 *
 * SSR note: the registry is module-global (process-wide), by design — like a
 * global middleware hook. Under server rendering it therefore applies to every
 * app and every request in the process, not per request. Register plugins once
 * at startup; don't register per request. This is intentional, not an injectable
 * per-app service (see the `instanceCounters` note below for the same rationale).
 */
export function onStoreCreated(plugin: (ctx: StorePluginContext) => void): Subscription {
    storePlugins.add(plugin);
    return {
        unsubscribe: () => {
            storePlugins.delete(plugin);
        }
    };
}

// ============================================================================
// defineStore
// ============================================================================

// Per-store-name monotonic instance counter, module-global (process-wide) ON
// PURPOSE. The `name#count` id it mints feeds each instance's topic namespaces
// (`${id}.events`, action topics), which register in core's global topic
// registry. A shared per-process counter keeps concurrent instances — including
// concurrent SSR requests in one Node process — on distinct ids, so their topic
// namespaces never collide in that registry. Resetting it per request would be
// unsafe (two in-flight requests could both mint `name#1`). The count never
// reaches the client: the SSR transfer key is `store:<storeName>`, not the id,
// so unbounded growth is cosmetic. This is deliberately NOT a per-app injectable.
const instanceCounters = new Map<string, number>();

/**
 * Tuple-typed setup parameters: any arity is preserved with full inference
 * (no fixed overload ceiling).
 */
export function defineStore<TReturn extends object, TArgs extends unknown[] = []>(
    name: string,
    setup: (ctx: SetupStoreContext, ...args: TArgs) => TReturn,
    lifetime?: Lifetime
): (...args: TArgs) => UnwrapStore<TReturn>;
export function defineStore<TReturn extends object>(
    name: string,
    setup: (ctx: SetupStoreContext, ...args: any[]) => TReturn,
    lifetime: Lifetime = 'scoped'
) {
    return defineFactory((ctxFactory: SetupFactoryContext, ...args: unknown[]) => {
        const count = (instanceCounters.get(name) ?? 0) + 1;
        instanceCounters.set(name, count);
        const id = `${name}#${count}`;

        const topics: Topic<unknown>[] = [];
        const groups: { destroy(): void }[] = [];

        const ctx: SetupStoreContext = {
            ...ctxFactory,
            storeName: name,
            instanceId: id,
            defineState: initial => makeState(initial, id, topics),
            defineActions: actions => makeActions(actions, id, topics),
            defineEvents: <EventMap extends Record<string, any>>() => {
                const group = createTopicGroup<EventMap>({ namespace: `${id}.events` });
                groups.push(group);
                return group.topics;
            }
        };

        const result = setup(ctx, ...args);
        if (result === null || typeof result !== 'object') {
            throw new Error(`[@sigx/store] ${id}: the store setup must return an object.`);
        }

        ctxFactory.onDeactivated(() => {
            // Destroying topics deactivates their refCount watchers too.
            topics.forEach(topic => topic.destroy());
            groups.forEach(group => group.destroy());
        });

        const store = buildStoreProxy(result as Record<string | symbol, unknown>, id);

        for (const plugin of storePlugins) {
            try {
                plugin({
                    name,
                    instanceId: id,
                    instance: result,
                    onDeactivated: ctxFactory.onDeactivated
                });
            } catch (err) {
                if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
                    console.error(`[@sigx/store] ${id}: error in onStoreCreated plugin:`, err);
                } else {
                    console.error(err);
                }
            }
        }

        return store;
    }, lifetime) as unknown as (...args: unknown[]) => UnwrapStore<TReturn>;
}

// ============================================================================
// storeToSignals
// ============================================================================

/**
 * Destructuring-safe views of a store: key signals for state keys, read-only
 * signal views for computeds. Functions and `$`-meta are skipped.
 *
 * @example
 * ```ts
 * const { todos, remaining } = storeToSignals(store);
 * todos.value.push(item);   // still reactive
 * ```
 */
export function storeToSignals<TReturn extends object>(store: { readonly [StoreShape]?: TReturn }): {
    [K in keyof TReturn as TReturn[K] extends KeySignal<any> | Computed<any> ? K : never]:
        TReturn[K] extends KeySignal<infer V> ? KeySignal<V>
        : TReturn[K] extends Computed<infer V> ? { readonly value: V }
        : never;
} {
    const internals = storeInternals.get(store as object);
    if (!internals) {
        throw new Error('[@sigx/store] storeToSignals expects a store instance created by defineStore.');
    }

    const result: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(internals.target);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        // Accessor-returned signals/computeds count too (same contract as
        // the store's lazy $patch/$events resolution) — evaluating the
        // getter once here is how we find out what it yields.
        const value = 'value' in descriptor ? descriptor.value : Reflect.get(internals.target, key);
        if (isKeySignal(value)) {
            result[key] = value;
        } else if (isComputed(value)) {
            result[key] = {
                get value() {
                    return (value as Computed<unknown>).value;
                }
            };
        }
    }
    return result as ReturnType<typeof storeToSignals<TReturn>>;
}
