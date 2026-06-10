import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineStore } from '../src/store';
import { persist, type PersistHandle, type PersistOptions } from '../src/persist';

/** Unique store name per test — instance ids count per name. */
let storeCounter = 0;

/** Tiny in-memory synchronous StorageLike. */
function createSyncStorage(seed: Record<string, string> = {}) {
    const data = new Map(Object.entries(seed));
    return {
        data,
        getItem: vi.fn((key: string) => (data.has(key) ? data.get(key)! : null)),
        setItem: vi.fn((key: string, value: string) => {
            data.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
            data.delete(key);
        }),
    };
}

/** Async (Promise-based) wrapper, AsyncStorage-style. */
function createAsyncStorage(seed: Record<string, string> = {}) {
    const data = new Map(Object.entries(seed));
    return {
        data,
        getItem: vi.fn(async (key: string) => (data.has(key) ? data.get(key)! : null)),
        setItem: vi.fn(async (key: string, value: string) => {
            data.set(key, value);
        }),
        removeItem: vi.fn(async (key: string) => {
            data.delete(key);
        }),
    };
}

/**
 * Create a store that persists its single state slice. The persist handle is
 * exposed as `handle` on the flat surface; `onState` runs before persist so
 * tests can subscribe to key events ahead of hydration.
 */
function createPersistedStore<T extends object>(
    initial: T,
    options?: PersistOptions<T>,
    onState?: (events: Record<string, { subscribe(fn: (value: any, prev: any) => void): { unsubscribe(): void } }>) => void
) {
    const name = `persistTest_${++storeCounter}`;
    const useStore = defineStore(name, (ctx) => {
        const { state, signals, events, patch } = ctx.defineState(initial);
        onState?.(events as any);
        const handle = persist(ctx, { state, patch }, options);
        return { ...signals, handle };
    });
    const store = useStore() as unknown as T & {
        handle: PersistHandle;
        readonly $id: string;
        $dispose(): void;
    };
    return { name, store };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('persist — hydration', () => {
    it('hydrates synchronously from sync storage via one atomic patch (one event per key)', async () => {
        const storage = createSyncStorage({
            k: JSON.stringify({ v: 1, data: { count: 42, label: 'saved' } }),
        });
        const countSpy = vi.fn();
        const labelSpy = vi.fn();

        const { store } = createPersistedStore(
            { count: 0, label: 'default' },
            { key: 'k', storage },
            events => {
                events.count.subscribe(countSpy);
                events.label.subscribe(labelSpy);
            }
        );

        expect(store.count).toBe(42);
        expect(store.label).toBe('saved');
        expect(store.handle.hydrated.value).toBe(true);
        await store.handle.whenHydrated; // already resolved for sync storage

        expect(countSpy).toHaveBeenCalledTimes(1);
        expect(countSpy).toHaveBeenCalledWith(42, 0);
        expect(labelSpy).toHaveBeenCalledTimes(1);
        expect(labelSpy).toHaveBeenCalledWith('saved', 'default');

        // Hydration alone must not write back to storage.
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('async storage: hydrated is false until the read resolves, then values apply', async () => {
        const storage = createAsyncStorage({
            k: JSON.stringify({ v: 1, data: { count: 42 } }),
        });

        const { store } = createPersistedStore({ count: 0 }, { key: 'k', storage });

        expect(store.handle.hydrated.value).toBe(false);
        expect(store.count).toBe(0); // defaults until the async read lands

        await store.handle.whenHydrated;

        expect(store.handle.hydrated.value).toBe(true);
        expect(store.count).toBe(42);
    });

    it('SAVE RACE: a mutation before async hydration completes never overwrites storage', async () => {
        const seeded = JSON.stringify({ v: 1, data: { count: 42 } });
        const storage = createAsyncStorage({ k: seeded });

        const { store } = createPersistedStore({ count: 0 }, { key: 'k', storage });

        // Mutate BEFORE hydration completes: saving is paused until hydrated,
        // so this must not race the defaults (or this value) into storage.
        store.count = 99;
        expect(storage.setItem).not.toHaveBeenCalled();

        await store.handle.whenHydrated;

        // The hydration patch overwrites the early mutation.
        expect(store.count).toBe(42);

        // Flush any (incorrect) pending write — storage must still hold the
        // seeded data, untouched.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.data.get('k')).toBe(seeded);
    });
});

describe('persist — saving', () => {
    it('saves on change with the { v, data } envelope (sync storage, no debounce)', () => {
        const storage = createSyncStorage();
        const { store } = createPersistedStore({ count: 0 }, { key: 'k', storage });

        expect(storage.setItem).not.toHaveBeenCalled();

        store.count = 5;

        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.data.get('k')!)).toEqual({ v: 1, data: { count: 5 } });
    });

    it('defaults the storage key to sigx:<storeName>', () => {
        const storage = createSyncStorage();
        const { name, store } = createPersistedStore({ count: 0 }, { storage });

        store.count = 1;

        expect(storage.data.has(`sigx:${name}`)).toBe(true);
    });

    it('debounce batches rapid changes into one trailing write', () => {
        vi.useFakeTimers();
        const storage = createSyncStorage();
        const { store } = createPersistedStore({ count: 0 }, { key: 'k', storage, debounce: 50 });

        store.count = 1;
        store.count = 2;
        expect(storage.setItem).not.toHaveBeenCalled();

        vi.advanceTimersByTime(49);
        expect(storage.setItem).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.data.get('k')!)).toEqual({ v: 1, data: { count: 2 } });
    });

    it('pick limits both hydration and saving to the picked keys', () => {
        const storage = createSyncStorage({
            k: JSON.stringify({ v: 1, data: { count: 7, label: 'persisted' } }),
        });
        const { store } = createPersistedStore(
            { count: 0, label: 'default' },
            { key: 'k', storage, pick: ['count'] }
        );

        // Hydration: only the picked key applies.
        expect(store.count).toBe(7);
        expect(store.label).toBe('default');

        store.count = 8;
        const saved = JSON.parse(storage.data.get('k')!);
        expect(saved.data).toEqual({ count: 8 }); // label excluded from saves
    });
});

describe('persist — versioning', () => {
    it('calls migrate(persistedData, fromVersion) when versions differ', () => {
        const storage = createSyncStorage({
            k: JSON.stringify({ v: 1, data: { count: 1 } }),
        });
        const migrate = vi.fn((persisted: unknown) => ({
            count: (persisted as { count: number }).count + 100,
        }));

        const { store } = createPersistedStore(
            { count: 0 },
            { key: 'k', storage, version: 2, migrate }
        );

        expect(migrate).toHaveBeenCalledTimes(1);
        expect(migrate).toHaveBeenCalledWith({ count: 1 }, 1);
        expect(store.count).toBe(101);

        // Subsequent saves write the NEW version into the envelope.
        store.count = 102;
        expect(JSON.parse(storage.data.get('k')!)).toEqual({ v: 2, data: { count: 102 } });
    });

    it('does not call migrate when the persisted version matches', () => {
        const storage = createSyncStorage({
            k: JSON.stringify({ v: 2, data: { count: 9 } }),
        });
        const migrate = vi.fn();

        const { store } = createPersistedStore(
            { count: 0 },
            { key: 'k', storage, version: 2, migrate }
        );

        expect(migrate).not.toHaveBeenCalled();
        expect(store.count).toBe(9);
    });
});

describe('persist — environment and lifecycle', () => {
    it('no storage available (SSR): immediate no-op hydration, nothing throws', async () => {
        // happy-dom provides localStorage; stub it away to simulate SSR.
        vi.stubGlobal('localStorage', undefined);

        const { store } = createPersistedStore({ count: 0 });

        expect(store.handle.hydrated.value).toBe(true);
        await store.handle.whenHydrated;

        store.count = 5; // persistence is a no-op — must not throw
        expect(store.count).toBe(5);
        await store.handle.clear(); // also a no-op
    });

    it('clear() removes the persisted entry', async () => {
        const storage = createSyncStorage();
        const { store } = createPersistedStore({ count: 0 }, { key: 'k', storage });

        store.count = 1;
        expect(storage.data.has('k')).toBe(true);

        await store.handle.clear();

        expect(storage.removeItem).toHaveBeenCalledWith('k');
        expect(storage.data.has('k')).toBe(false);
    });

    it('after store dispose, mutations no longer write', () => {
        const storage = createSyncStorage();
        const { store } = createPersistedStore({ count: 0 }, { key: 'k', storage });

        store.count = 1;
        expect(storage.setItem).toHaveBeenCalledTimes(1);

        store.$dispose();

        store.count = 2;
        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.data.get('k')!)).toEqual({ v: 1, data: { count: 1 } });
    });
});
