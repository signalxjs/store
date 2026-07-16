import { watch, type WatchHandle } from "@sigx/reactivity";
import type { Patch, SetupStoreContext } from "./store.js";

/**
 * Minimal storage contract — satisfied by localStorage, sessionStorage, and
 * async stores like React Native's AsyncStorage (Promise-returning methods).
 */
export interface StorageLike {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem?(key: string): void | Promise<void>;
}

export interface PersistOptions<TState extends object> {
    /** Storage key. Defaults to `sigx:<storeName>` (the logical store name) — pass one explicitly when persisting multiple slices. */
    key?: string;
    /** Defaults to globalThis.localStorage. Absent storage (SSR) → persist is a no-op and `hydrated` is immediately true. */
    storage?: StorageLike;
    /** Persist (and hydrate) only these keys. Default: all slice keys. */
    pick?: (keyof TState)[];
    serialize?(snapshot: Partial<TState>): string;
    deserialize?(raw: string): unknown;
    /** Schema version stored alongside the data. */
    version?: number;
    /** Convert data persisted under an older version. Receives the raw deserialized payload. */
    migrate?(persisted: unknown, fromVersion: number): Partial<TState>;
    /** Debounce for writes, in ms. Default 0 (write on every change flush). */
    debounce?: number;
}

export interface PersistHandle {
    /** Reactive-ish flag (plain readonly view): true once hydration has completed. */
    hydrated: { readonly value: boolean };
    /** Resolves when hydration has completed (immediately for sync/no storage). */
    whenHydrated: Promise<void>;
    /** Remove the persisted entry from storage. */
    clear(): Promise<void>;
}

type Envelope = { v: number; data: unknown };

/**
 * Persist a state slice to storage and rehydrate it on store creation.
 * Call inside a store setup:
 *
 * ```ts
 * const useSettings = defineStore('settings', (ctx) => {
 *     const { state, signals, patch } = ctx.defineState({ theme: 'dark', locale: 'en' });
 *     const { hydrated } = persist(ctx, { state, patch }, { storage: AsyncStorage, pick: ['theme'] });
 *     return { ...signals, hydrated };
 * }, 'singleton');
 * ```
 *
 * - Hydration is one atomic `patch()` (a single reactivity flush).
 * - Saving is a deep watch over the picked keys, debounced, and PAUSED until
 *   hydration completes — async hydration can never be overwritten by the
 *   defaults racing it to storage.
 * - Everything is cleaned up when the store is disposed.
 */
export function persist<TState extends object>(
    ctx: SetupStoreContext,
    slice: { state: TState; patch: Patch<TState> },
    options: PersistOptions<TState> & { key: string }
): PersistHandle;
export function persist<TState extends object>(
    ctx: SetupStoreContext,
    slice: { state: TState; patch: Patch<TState> },
    options?: PersistOptions<TState>
): PersistHandle;
export function persist<TState extends object>(
    ctx: SetupStoreContext,
    slice: { state: TState; patch: Patch<TState> },
    options: PersistOptions<TState> = {}
): PersistHandle {
    const { state, patch } = slice;
    let defaultStorage: StorageLike | undefined;
    if (!options.storage && typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
        // Merely ACCESSING localStorage can throw (Safari private mode,
        // blocked storage) — treat that as "no storage available".
        try {
            defaultStorage = (globalThis as { localStorage?: StorageLike }).localStorage;
        } catch {
            defaultStorage = undefined;
        }
    }
    const storage = options.storage ?? defaultStorage;
    // Keyed by the LOGICAL store name (not the instance id) so persistence
    // survives across instances. With 'transient' stores sharing one key,
    // instances will fight over it — pass explicit keys there.
    const key = options.key ?? `sigx:${ctx.storeName}`;
    const version = options.version ?? 1;
    const serialize = options.serialize ?? ((snapshot: Partial<TState>) => JSON.stringify({ v: version, data: snapshot } satisfies Envelope));
    const deserialize = options.deserialize ?? ((raw: string) => JSON.parse(raw) as unknown);
    const pickKeys = (options.pick ?? (Object.keys(state) as (keyof TState)[])).map(String);

    let isHydrated = false;
    const hydrated = {
        get value() {
            return isHydrated;
        }
    };

    // No storage (e.g. SSR): no-op — render with defaults, never write.
    if (!storage) {
        isHydrated = true;
        return { hydrated, whenHydrated: Promise.resolve(), clear: async () => { } };
    }

    const snapshot = (): Partial<TState> => {
        const out: Record<string, unknown> = {};
        for (const k of pickKeys) {
            out[k] = (state as Record<string, unknown>)[k];
        }
        return out as Partial<TState>;
    };

    let watchHandle: WatchHandle | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const write = () => {
        if (disposed || !isHydrated) return;
        // Persistence failures (quota, privacy modes, broken async stores)
        // must never crash the app or surface as unhandled rejections — the
        // store keeps working from memory.
        try {
            const result = storage.setItem(key, serialize(snapshot())) as Promise<void> | void;
            if (result && typeof result.then === 'function') {
                result.catch(err => {
                    if (__DEV__) {
                        console.error(`[@sigx/store] persist("${key}"): write failed:`, err);
                    } else {
                        console.error(err);
                    }
                });
            }
        } catch (err) {
            if (__DEV__) {
                console.error(`[@sigx/store] persist("${key}"): write failed:`, err);
            } else {
                console.error(err);
            }
        }
    };

    const scheduleWrite = () => {
        if (disposed || !isHydrated) return;
        if (options.debounce && options.debounce > 0) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(write, options.debounce);
        } else {
            write();
        }
    };

    const startSaving = () => {
        if (disposed) return;
        watchHandle = watch(snapshot, scheduleWrite, { deep: true });
    };

    const applyPersisted = (raw: string | null) => {
        // The store may be disposed before async hydration resolves — never
        // patch or start watchers on a dead store.
        if (disposed) {
            isHydrated = true;
            return;
        }
        // One corrupted storage entry (bad JSON, throwing migrate, throwing
        // patch) must not brick store creation — fall back to defaults,
        // still mark hydrated, and start saving (the next write self-heals
        // the stored entry).
        try {
            if (raw !== null) {
                const payload = deserialize(raw);
                let data: Partial<TState>;
                const envelope = payload as Envelope | null;
                const persistedVersion = envelope && typeof envelope === 'object' && typeof envelope.v === 'number' ? envelope.v : 0;
                const persistedData = envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : payload;
                if (persistedVersion !== version && options.migrate) {
                    data = options.migrate(persistedData, persistedVersion);
                } else {
                    data = persistedData as Partial<TState>;
                }
                if (data && typeof data === 'object') {
                    const filtered: Record<string, unknown> = {};
                    for (const k of pickKeys) {
                        if (k in (data as Record<string, unknown>)) {
                            filtered[k] = (data as Record<string, unknown>)[k];
                        }
                    }
                    patch(filtered as Partial<TState>);
                }
            }
        } catch (err) {
            if (__DEV__) {
                console.error(`[@sigx/store] persist("${key}"): hydration failed, continuing with defaults:`, err);
            } else {
                console.error(err);
            }
        }
        isHydrated = true;
        startSaving();
    };

    // getItem can throw synchronously (privacy modes, quota errors) — treat
    // it like any other failed read: defaults, hydrated, saving started.
    let initial: string | null | Promise<string | null> = null;
    let readFailed = false;
    try {
        initial = storage.getItem(key);
    } catch (err) {
        if (__DEV__) {
            console.error(`[@sigx/store] persist("${key}"): storage read failed, continuing with defaults:`, err);
        } else {
            console.error(err);
        }
        readFailed = true;
    }

    const whenHydrated = !readFailed && typeof (initial as Promise<string | null> | null)?.then === 'function'
        ? (initial as Promise<string | null>).then(applyPersisted, err => {
            // A broken storage read must not block the app on defaults forever.
            if (__DEV__) {
                console.error(`[@sigx/store] persist("${key}"): hydration failed:`, err);
            } else {
                console.error(err);
            }
            isHydrated = true;
            startSaving();
        })
        : (applyPersisted(readFailed ? null : initial as string | null), Promise.resolve());

    ctx.onDeactivated(() => {
        disposed = true;
        if (timer) clearTimeout(timer);
        watchHandle?.stop();
    });

    return {
        hydrated,
        whenHydrated,
        clear: async () => {
            await storage.removeItem?.(key);
        }
    };
}
