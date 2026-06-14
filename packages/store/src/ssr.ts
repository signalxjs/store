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
 * - **Client**: seeds the slice from `window.__SIGX_ASYNC__['store:<name>']`
 *   as ONE atomic `patch()` (a single reactivity flush), consume-once — a
 *   later instance of the same store starts from defaults instead of
 *   forking from the seed.
 * - Composition with `persist()`: call `ssrState` FIRST — it seeds
 *   synchronously; persist's (possibly async) hydration then overwrites
 *   with device-local data when present.
 */

import { getCurrentInstance } from "@sigx/runtime-core";
import type { Patch, SetupStoreContext } from "./store.js";

export interface SSRStateOptions<TState extends object> {
    /** Serialize (and seed) only these keys. Default: all slice keys. */
    pick?: Extract<keyof TState, string>[];
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

    // ── Server: register for serialization ────────────────────────────
    // The server walk installs `ssr._ctx` (the per-request render context)
    // on the resolving component's instance. Store setups run during
    // component resolution, so this is available — and per-request correct
    // by construction.
    const instance = getCurrentInstance() as any;
    const renderCtx = instance?.ssr?.isServer ? instance.ssr._ctx : null;

    // Duck-typed boundary: tolerate render contexts without the expected
    // Map-like _asyncResults (older/alternative SSR runtimes) instead of
    // throwing inside a store setup.
    const results = renderCtx?._asyncResults;
    if (results && typeof results.set === 'function') {
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && typeof results.has === 'function' && results.has(key)) {
            console.warn(
                `[@sigx/store] ssrState: "${ctx.storeName}" registered twice in one request — ` +
                `the serialized state would be last-write-wins. One store ` +
                `instance per name per request is the supported shape.`
            );
        }
        // LIVE registration: toJSON defers the snapshot to emit time (the
        // serializer stringifies after the shell render), so state mutated
        // during the request serializes with its final values.
        results.set(key, {
            toJSON: () => snapshot(slice.state, options.pick)
        });
        return { hydrated: false };
    }

    // On the server but with no usable render context: bail out. We must NOT
    // fall through to the client seeding path below — `globalThis.__SIGX_ASYNC__`
    // can exist as a Node global shared across requests, which would patch
    // server-side state from another request's blob.
    if (instance?.ssr?.isServer) {
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            console.warn(
                `[@sigx/store] ssrState: "${ctx.storeName}" was created on the server outside ` +
                `a render context — its state cannot be serialized for hydration.`
            );
        }
        return { hydrated: false };
    }

    // ── Client: seed from the blob (consume-once) ──────────────────────
    // Gate seeding behind a browser-like global. The `ssr.isServer` check
    // above is the primary server signal, but a store created on the server
    // *outside* component resolution has no instance to detect — without this
    // guard it would fall through and read the blob from `globalThis`, which
    // in a long-lived Node process is shared across requests. The blob is
    // emitted as `window.__SIGX_ASYNC__`, so its absence means "not a browser".
    if (typeof window === 'undefined') {
        return { hydrated: false };
    }
    const blob = (globalThis as any).__SIGX_ASYNC__;
    if (blob && Object.prototype.hasOwnProperty.call(blob, key)) {
        const seed = blob[key];
        delete blob[key];

        // Plain objects only — an array (or other exotic) seed would
        // Object.assign numeric keys onto the state shape.
        if (seed && typeof seed === 'object' && !Array.isArray(seed)) {
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
            slice.patch(filtered);
            return { hydrated: true };
        }
    }

    return { hydrated: false };
}
