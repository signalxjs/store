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
    pick?: (keyof TState)[];
}

export interface SSRStateHandle {
    /** True when a server seed was applied to this instance (client only). */
    readonly hydrated: boolean;
}

function isDev(): boolean {
    // Absent NODE_ENV (production browser builds without an injected
    // `process`) must NOT enable dev warnings — only an explicitly set
    // non-production value does (vite dev sets 'development', vitest 'test').
    const env = (globalThis as any).process?.env?.NODE_ENV;
    return env !== undefined && env !== 'production';
}

/** Plain snapshot of the (picked) slice keys — reads through the proxy. */
function snapshot<TState extends object>(
    state: TState,
    pick: (keyof TState)[] | undefined
): Partial<TState> {
    const out: Partial<TState> = {};
    const keys = pick ?? (Object.keys(state) as (keyof TState)[]);
    for (const key of keys) {
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

    if (renderCtx?._asyncResults) {
        if (isDev() && renderCtx._asyncResults.has(key)) {
            console.warn(
                `[ssrState] "${ctx.storeName}" registered twice in one request — ` +
                `the serialized state would be last-write-wins. One store ` +
                `instance per name per request is the supported shape.`
            );
        }
        // LIVE registration: toJSON defers the snapshot to emit time (the
        // serializer stringifies after the shell render), so state mutated
        // during the request serializes with its final values.
        renderCtx._asyncResults.set(key, {
            toJSON: () => snapshot(slice.state, options.pick)
        });
        return { hydrated: false };
    }

    if (isDev() && instance?.ssr?.isServer) {
        console.warn(
            `[ssrState] "${ctx.storeName}" was created on the server outside ` +
            `a render context — its state cannot be serialized for hydration.`
        );
    }

    // ── Client: seed from the blob (consume-once) ──────────────────────
    const blob = (globalThis as any).__SIGX_ASYNC__;
    if (blob && Object.prototype.hasOwnProperty.call(blob, key)) {
        const seed = blob[key];
        delete blob[key];

        // Plain objects only — an array (or other exotic) seed would
        // Object.assign numeric keys onto the state shape.
        if (seed && typeof seed === 'object' && !Array.isArray(seed)) {
            const filtered = options.pick
                ? (Object.fromEntries(
                    options.pick
                        .filter(k => Object.prototype.hasOwnProperty.call(seed, k))
                        .map(k => [k, (seed as Record<string, unknown>)[k as string]])
                ) as Partial<TState>)
                : (seed as Partial<TState>);
            slice.patch(filtered);
            return { hydrated: true };
        }
    }

    return { hydrated: false };
}
