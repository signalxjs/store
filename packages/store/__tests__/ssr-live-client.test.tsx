/**
 * ssrState() — client seeding is gated by the core live-client signal.
 *
 * Isolated in its own file because `declareLiveClient()` sets module-global
 * state in @sigx/runtime-core that has no reset-to-default; vitest gives each
 * test file its own module registry, so the declaration can't leak into the
 * real-renderer tests in ssr.test.tsx (whose client-seed cases rely on the
 * default browser check).
 *
 * `isLiveClient()` defaults to `typeof window !== 'undefined'`, so web/SSR
 * behavior is unchanged; a declaration overrides it. These tests drive both
 * sides of the gate and the windowless-safe blob read (globalThis fallback).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { declareLiveClient } from '@sigx/runtime-core/internals';
import { defineStore } from '../src/store';
import { ssrState } from '../src/ssr';

let n = 0;
const nextName = () => `ssrLive_${++n}`;

// Transient so each call builds a fresh instance that runs the client path
// (ssrState called outside any render → server branch is skipped).
function makeStore(name: string) {
    return defineStore(name, (ctx) => {
        const { state, signals, patch } = ctx.defineState({ items: [] as string[], total: 0 });
        const handle = ssrState(ctx, { state, patch });
        return { ...signals, $ssr: handle };
    }, 'transient');
}

afterEach(() => {
    delete (globalThis as any).__SIGX_ASYNC__;
    if (typeof window !== 'undefined') delete (window as any).__SIGX_ASYNC__;
    // Leave a browser-like default for any later test in this file. (There is
    // no declareLiveClient reset-to-null; the module is file-isolated anyway.)
    declareLiveClient(true);
});

describe('ssrState — live-client gating', () => {
    it('seeds when isLiveClient() is true (browser default, no declaration touched)', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: ['seeded'], total: 7 } };

        const store = makeStore(name)() as any;

        expect(store.items).toEqual(['seeded']);
        expect(store.total).toBe(7);
        expect(store.$ssr.hydrated).toBe(true);
    });

    it('does NOT seed when the client declares itself non-live (window still present)', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: ['seeded'], total: 7 } };

        declareLiveClient(false);
        const store = makeStore(name)() as any;

        // Gate short-circuits: defaults kept, not hydrated…
        expect(store.items).toEqual([]);
        expect(store.$ssr.hydrated).toBe(false);
        // …and the blob entry is left intact (not consumed).
        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(true);
    });

    it('reads the blob from globalThis for a declared live client (windowless-safe fallback)', () => {
        const name = nextName();
        // Blob only on globalThis (not window) — the windowless transport shape.
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: ['from-global'], total: 3 } };

        declareLiveClient(true);
        const store = makeStore(name)() as any;

        expect(store.items).toEqual(['from-global']);
        expect(store.$ssr.hydrated).toBe(true);
        // Consume-once still holds through the globalThis path.
        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(false);
    });
});
