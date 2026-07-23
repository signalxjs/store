/**
 * SSR state transfer for stores — the @sigx/store half of the design in
 * signalxjs/core docs/rfc-use-async.md.
 *
 * Call inside a store setup, exactly like `persist()`:
 *
 * ```ts
 * import { ssrState } from '@sigx/store/ssr';
 *
 * const useTodos = defineStore('todos', (ctx) => {
 *     const { state, signals, patch } = ctx.defineState({ items: [] as Todo[] });
 *     ssrState(ctx, { state, patch });
 *     return { ...signals };
 * });
 * ```
 *
 * - **Server**: registers the slice's LIVE state under the key
 *   `store:<storeName>` on the per-request render context. The server
 *   renderer's `stateSerializationPlugin` (automatic under `renderDocument`)
 *   serializes it into `window.__SIGX_ASYNC__` when the shell is emitted —
 *   after rendering — so mutations made during the request are captured.
 *   Detection is duck-typed via the component instance's `ssr` helper; this
 *   module has NO dependency on @sigx/server-renderer.
 * - **Client**: seeds the slice from the page blob as ONE atomic `patch()`
 *   (a single reactivity flush). The entry STAYS in the blob
 *   (`scope: 'shared'`, the default), so every instance of the store created
 *   in this client runtime seeds from it — each with its own copy.
 *   `scope: 'instance'` restores consume-once.
 * - Composition with `persist()`: call `ssrState` FIRST — it seeds
 *   synchronously; persist's (possibly async) hydration then overwrites
 *   with device-local data when present.
 *
 * Reads go through core's blob accessors (`peekRestored`/`invalidateRestored`)
 * — THE decode point for that seam, so a slice carrying `Date`/`Map`/`Set`/
 * `BigInt` is revived with the same codec `useData` and `@sigx/cache` get, and
 * the store stops being the one reader in sigx that deletes what it read. Since
 * core 0.13 (#407) those accessors gate on `isLiveClient()` and read
 * `globalThis`, so windowless live clients (lynx, terminal) are covered by core
 * itself — this module needs no blob access of its own.
 */

import { getCurrentInstance } from "@sigx/runtime-core";
import { invalidateRestored, isLiveClient, peekRestored } from "@sigx/runtime-core/internals";
import type { Patch, SetupStoreContext } from "./store.js";

export interface SSRStateOptions<TState extends object> {
    /** Serialize (and seed) only these keys. Default: all slice keys. */
    pick?: Extract<keyof TState, string>[];
    /**
     * Who the transferred state belongs to. Default `'shared'`.
     *
     * - `'shared'` — the state describes the whole client runtime (locale +
     *   catalogs, theme, session, feature flags), not one component. The blob
     *   entry survives seeding, so every instance created in that runtime
     *   starts from it: each island root is its own client component tree under
     *   `@sigx/ssr-islands`, and each separately-upgraded boundary can be one
     *   under `@sigx/resume`. Each instance gets a structural COPY, so one
     *   store's mutations can never reach another's. This matches core's
     *   `__SIGX_ASYNC__` contract — the blob is the page's data cache for its
     *   lifetime, and `useData` / `useStream` / `@sigx/cache` all read it
     *   without consuming.
     * - `'instance'` — consume-once: the entry is invalidated after seeding, so
     *   a later instance of the same store starts from defaults instead of
     *   forking from the seed. For state that genuinely belongs to ONE store
     *   instance — core's `docs/seams.md` names this as the shape for a pack
     *   seed that must not outlive its instance (a refreshed boundary does not
     *   re-deliver the blob).
     */
    scope?: 'shared' | 'instance';
}

export interface SSRStateHandle {
    /** True when a server seed was applied to this instance (client only). */
    readonly hydrated: boolean;
}

/** Keys with prototype-mutation semantics — never applied to state. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Plain snapshot of the (picked) slice keys — reads through the proxy.
 * Null-prototype accumulator + reserved-key skip: assigning a literal
 * "__proto__" slice/pick key into a plain object would mutate the
 * prototype before serialization.
 */
function snapshot<TState extends object>(
    state: TState,
    pick: Extract<keyof TState, string>[] | undefined
): Partial<TState> {
    const out: Partial<TState> = Object.create(null);
    // Slices only have string keys at runtime (defineState enumerates
    // Object.keys), so string-keyed iteration is exact.
    const keys = pick ?? (Object.keys(state) as Extract<keyof TState, string>[]);
    for (const key of keys) {
        if (RESERVED_KEYS.has(key)) continue;
        out[key] = state[key];
    }
    return out;
}

/**
 * Is this seed a plain record — the only shape a transferred slice ever has?
 *
 * An array would `Object.assign` numeric keys onto the state shape. Any other
 * exotic object (a `Date`/`Map` the codec revived from a hand-written blob
 * entry, a class instance from a custom type handler) carries no slice keys, so
 * patching it would report `hydrated: true` having applied nothing, and reading
 * through it could run getters or proxy traps.
 *
 * The check reads NO properties of the seed or its prototype — a seed is
 * attacker-controlled data, and `proto.constructor` alone would be enough to
 * fire a getter or a proxy trap. Prototype identity is all it looks at.
 *
 * A blob entry carrying a literal `"__proto__"` key therefore fails here: the
 * codec rebuilds objects by assignment, so such an entry comes back with its
 * prototype SWAPPED for that value and is rejected wholesale rather than
 * part-applied. Nothing legitimate produces that shape — `snapshot()` skips
 * reserved keys on the way out — so the only producer is a tampered blob, and
 * ignoring it entirely is the safer read. `Object.prototype` is never touched
 * either way.
 */
function isPlainSeed(seed: unknown): seed is Record<string, unknown> {
    if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return false;
    const proto = Object.getPrototypeOf(seed);
    return proto === null || proto === Object.prototype;
}

/**
 * Would a JSON round-trip lose information? Asked only on the fallback path
 * (a runtime without `structuredClone`), so it costs nothing anywhere else.
 *
 * Deliberately conservative — anything JSON does not represent EXACTLY is a
 * "no": `Date`/`Map`/`Set`/`RegExp` and other non-plain objects (which is what
 * the codec produces), `bigint`, `undefined` and functions (dropped or turned
 * to `null`), non-finite numbers (`null`), and cycles (a throw).
 */
function isJsonSafe(value: unknown, seen: Set<object>): boolean {
    if (value === null) return true;
    const type = typeof value;
    if (type === 'string' || type === 'boolean') return true;
    if (type === 'number') return Number.isFinite(value);
    if (type !== 'object') return false;

    const object = value as object;
    if (seen.has(object)) return false;
    seen.add(object);

    if (Array.isArray(object)) return object.every(item => isJsonSafe(item, seen));

    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(object).every(item => isJsonSafe(item, seen));
}

/**
 * Structural copy of the seed, taken before it reaches reactive state.
 *
 * Under `scope: 'shared'` the blob entry outlives the seeding, so handing its
 * nested objects to a store by reference would let that store's mutations write
 * THROUGH the reactive proxy into the blob — and from there into every instance
 * seeded afterwards.
 *
 * `structuredClone` first: it preserves what the codec revived (`Date`/`Map`/
 * `Set`) and handles cycles. The JSON fallback, for runtimes that lack it, is
 * used ONLY when a round-trip is lossless — flattening a revived `Date` into a
 * string would hand the store wrong data, which is worse than sharing. Anything
 * neither can copy is passed through by reference with a dev warning: a shared
 * seed beats both a failed hydration and a corrupted one.
 */
function copySeed<T>(seed: T, storeName: string): T {
    try {
        if (typeof structuredClone === 'function') return structuredClone(seed);
    } catch {
        // Not cloneable by the structured-clone algorithm (a function, a proxy,
        // a class instance from a custom __SIGX_TYPE_HANDLERS__ entry).
    }
    if (isJsonSafe(seed, new Set())) {
        return JSON.parse(JSON.stringify(seed)) as T;
    }
    if (__DEV__) {
        console.warn(
            `[@sigx/store] ssrState: "${storeName}" could not copy its server seed — ` +
            `it is shared by reference with any other instance seeded from the same entry, ` +
            `so a mutation in one instance can reach the others. Use \`pick\` to transfer ` +
            `only copyable values, or \`scope: 'instance'\`.`
        );
    }
    return seed;
}

/**
 * Transfer a state slice from server render to client hydration.
 *
 * Returns `{ hydrated }` — whether a server seed was applied (always false
 * on the server).
 */
export function ssrState<TState extends object>(
    ctx: SetupStoreContext,
    slice: { state: TState; patch: Patch<TState> },
    options: SSRStateOptions<TState> = {}
): SSRStateHandle {
    const key = `store:${ctx.storeName}`;
    const scope = options.scope ?? 'shared';

    // ── Server: register for serialization ────────────────────────────
    // The server walk installs `ssr._ctx` (the per-request render context)
    // on the resolving component's instance. Store setups run during
    // component resolution, so this is available — and per-request correct
    // by construction.
    const instance = getCurrentInstance() as any;
    const renderCtx = instance?.ssr?.isServer ? instance.ssr._ctx : null;

    // Duck-typed boundary: tolerate render contexts without the public
    // `registerSerializedState` write path (older/alternative SSR runtimes)
    // instead of throwing inside a store setup.
    if (renderCtx && typeof renderCtx.registerSerializedState === 'function') {
        // Only worth flagging for instance-scoped state: two instances of a
        // SHARED store describe the same client runtime, so the entry they race
        // to register holds the same values either way. For instance scope,
        // last-write-wins silently picks one instance's state.
        if (
            __DEV__ &&
            scope === 'instance' &&
            typeof renderCtx._asyncResults?.has === 'function' &&
            renderCtx._asyncResults.has(key)
        ) {
            console.warn(
                `[@sigx/store] ssrState: "${ctx.storeName}" registered twice in one request — ` +
                `the serialized state is last-write-wins. With \`scope: 'instance'\`, one ` +
                `store instance per name per request is the supported shape.`
            );
        }
        // LIVE registration: toJSON defers the snapshot to emit time (the
        // serializer stringifies after the shell render), so state mutated
        // during the request serializes with its final values. The public
        // `registerSerializedState` (@sigx/server-renderer #407) writes
        // `_asyncResults` AND marks the key in `_unflushedAsyncKeys`, so the
        // `stateSerializationPlugin` drain actually emits it — a bare
        // `_asyncResults.set()` is silently dropped from the blob.
        renderCtx.registerSerializedState(key, {
            toJSON: () => snapshot(slice.state, options.pick)
        });
        return { hydrated: false };
    }

    // On the server but with no usable render context: bail out. We must NOT
    // fall through to the client seeding path below — `globalThis.__SIGX_ASYNC__`
    // can exist as a Node global shared across requests, which would patch
    // server-side state from another request's blob.
    if (instance?.ssr?.isServer) {
        if (__DEV__) {
            console.warn(
                `[@sigx/store] ssrState: "${ctx.storeName}" was created on the server outside ` +
                `a render context — its state cannot be serialized for hydration.`
            );
        }
        return { hydrated: false };
    }

    // ── Client: seed from the blob ─────────────────────────────────────
    // Gate seeding behind the live-client signal. The `ssr.isServer` check
    // above is the primary server signal, but a store created on the server
    // *outside* component resolution has no instance to detect — without this
    // guard it would fall through to a blob read, and `globalThis.__SIGX_ASYNC__`
    // in a long-lived Node process is shared across requests. Core's accessors
    // gate on `isLiveClient()` themselves since 0.13 (#407), so this is belt and
    // braces — and it is what keeps `hydrated` honest for the warning below.
    if (!isLiveClient()) {
        // The no-instance case is the one that bites in practice: a store whose
        // FIRST resolution happens outside component resolution — a router
        // guard, or the createApp factory via `app.runWithContext` — has no
        // instance to carry `ssr._ctx`, so the server branch above is skipped,
        // nothing registers, and the client silently starts from defaults.
        if (__DEV__ && !instance) {
            console.warn(
                `[@sigx/store] ssrState: "${ctx.storeName}" was first created outside component ` +
                `resolution — its state will not transfer. Resolve the store inside a component ` +
                `(and provide request state through DI for pre-render consumers such as guards).`
            );
        }
        return { hydrated: false };
    }

    // `peekRestored` is THE decode point for the blob: it applies the type codec
    // and, since core 0.13, handles live-client gating and windowless transports
    // itself — no second reader of the global here.
    const { hit, value: seed } = peekRestored(key);
    if (hit) {
        // Consume-once drops the entry on any hit, valid shape or not — an
        // unusable seed is still this instance's, and leaving it would hand it
        // to the next one. Shared scope never drops: the entry belongs to the
        // client runtime, for its lifetime.
        if (scope === 'instance') invalidateRestored(key);

        // Plain records only — a transferred slice is always a plain snapshot.
        if (isPlainSeed(seed)) {
            // ALWAYS filter to the slice's known keys (∩ pick): a tampered
            // blob must not assign unexpected keys onto the reactive state.
            // Reserved keys are excluded from the allow-list itself, so even
            // a caller-supplied pick (e.g. via `as any`) can't smuggle
            // "__proto__"-style keys into patch()'s Object.assign.
            // pick ∩ ACTUAL slice keys: a pick entry for a key the slice
            // doesn't have must not let the blob patch it in.
            const sliceKeys = new Set(Object.keys(slice.state));
            const allowed = (options.pick ?? (Object.keys(slice.state) as Extract<keyof TState, string>[]))
                .filter(k => sliceKeys.has(k) && !RESERVED_KEYS.has(k));
            const filtered = Object.fromEntries(
                allowed
                    .filter(k => Object.prototype.hasOwnProperty.call(seed, k))
                    .map(k => [k, (seed as Record<string, unknown>)[k]])
            ) as Partial<TState>;
            // Copy AFTER filtering — only the values that actually reach the
            // state are worth cloning. Consumed entries need no copy: nothing
            // else can reach them once they are out of the blob.
            slice.patch(scope === 'shared' ? copySeed(filtered, ctx.storeName) : filtered);
            return { hydrated: true };
        }
    }

    return { hydrated: false };
}
