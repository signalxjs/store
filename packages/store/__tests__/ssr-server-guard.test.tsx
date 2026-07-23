/**
 * ssrState() — server-without-render-context guard.
 *
 * Isolated in its own file so the `vi.mock` of @sigx/runtime-core (needed to
 * fake `getCurrentInstance`) can't leak into the real-renderer integration
 * tests in ssr.test.tsx. Here we simulate a server instance whose render
 * context exposes no usable `_asyncResults` (an older/alternative SSR
 * runtime): ssrState must bail out, NOT fall through to client seeding —
 * otherwise a `__SIGX_ASYNC__` global shared across requests in the Node
 * process could patch server-side state from another request's blob.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Controllable getCurrentInstance; all other runtime-core exports stay real
// (defineStore depends on them).
const currentInstance = vi.fn();
vi.mock('@sigx/runtime-core', async (importActual) => {
    const actual = await importActual<typeof import('@sigx/runtime-core')>();
    return { ...actual, getCurrentInstance: () => currentInstance() };
});

import { defineStore } from '../src/store';
import { ssrState } from '../src/ssr';

let n = 0;
const nextName = () => `ssrGuard_${++n}`;

// A server instance whose render context has no Map-like _asyncResults.
const serverInstanceWithoutResults = { ssr: { isServer: true, _ctx: {} } };

afterEach(() => {
    delete (globalThis as any).__SIGX_ASYNC__;
    currentInstance.mockReset();
    vi.unstubAllGlobals();
});

describe('ssrState — server without a usable render context', () => {
    it('never seeds from a stray global __SIGX_ASYNC__ on the server', () => {
        const name = nextName();
        currentInstance.mockReturnValue(serverInstanceWithoutResults);
        // A blob from another request must NOT leak into server-side state.
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: ['leak'] } };

        const useStore = defineStore(name, (ctx) => {
            const { state, signals, patch } = ctx.defineState({ items: [] as string[] });
            const handle = ssrState(ctx, { state, patch });
            return { ...signals, $ssr: handle };
        }, 'transient');

        const store = useStore() as any;

        expect(store.$ssr.hydrated).toBe(false);                                  // did not seed
        expect(store.items).toEqual([]);                                          // defaults preserved
        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(true); // blob untouched (not consumed)
    });

    it('outside component resolution (no instance, non-DOM) does not seed from the global blob', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        currentInstance.mockReturnValue(null); // not in a render → no ssr signal to detect
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: ['leak'] } };
        vi.stubGlobal('window', undefined);    // non-DOM server environment

        const useStore = defineStore(name, (ctx) => {
            const { state, signals, patch } = ctx.defineState({ items: [] as string[] });
            const handle = ssrState(ctx, { state, patch });
            return { ...signals, $ssr: handle };
        }, 'transient');

        const store = useStore() as any;

        expect(store.$ssr.hydrated).toBe(false);                                  // did not seed
        expect(store.items).toEqual([]);                                          // defaults preserved
        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(true); // blob untouched
        // …and it says so (#63): silently starting from defaults is what made
        // this cost a debugging session downstream (signalxjs/pulse#1).
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(`"${name}" was first created outside component resolution`)
        );
        warn.mockRestore();
    });

    it('dev-warns that the on-server state cannot be serialized', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        currentInstance.mockReturnValue(serverInstanceWithoutResults);

        const useStore = defineStore(name, (ctx) => {
            const { state, signals, patch } = ctx.defineState({ items: [] as string[] });
            ssrState(ctx, { state, patch });
            return { ...signals };
        }, 'transient');
        useStore();

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(`"${name}" was created on the server outside`)
        );
        warn.mockRestore();
    });
});
