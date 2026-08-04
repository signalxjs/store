/**
 * ssrState() — SSR state transfer for stores.
 *
 * Server side is integration-tested against the REAL @sigx/server-renderer
 * (devDep): a component resolves a store during render, ssrState registers
 * the live slice, and stateSerializationPlugin emits it into the
 * __SIGX_ASYNC__ blob under `store:<name>`. Client side seeds from the blob
 * via one atomic patch — shared by default (the entry survives, so every
 * instance seeds), consume-once under `scope: 'instance'`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { component, useData } from 'sigx';
import { createSSR, stateSerializationPlugin } from '@sigx/server-renderer';
import { defineStore } from '../src/store';
import { ssrState } from '../src/ssr';

let storeCounter = 0;
const nextName = () => `ssrStore_${++storeCounter}`;

afterEach(() => {
    delete (globalThis as any).__SIGX_ASYNC__;
    if (typeof window !== 'undefined') delete (window as any).__SIGX_ASYNC__;
    vi.unstubAllGlobals();
});

function makeCartStore(name: string, opts?: { pick?: any; scope?: 'shared' | 'instance' }) {
    return defineStore(name, (ctx) => {
        const { state, signals, patch } = ctx.defineState({
            items: [] as string[],
            total: 0,
            internalCursor: 'not-for-the-wire'
        });
        const handle = ssrState(ctx, { state, patch }, opts);
        return { ...signals, $ssr: handle, addItem(item: string, price: number) { state.items = [...state.items, item]; state.total += price; } };
    }, 'transient');
}

describe('ssrState — server serialization', () => {
    it('serializes the live store state into the __SIGX_ASYNC__ blob, including post-setup mutations', async () => {
        const name = nextName();
        const useCart = makeCartStore(name);

        const Page = component(() => {
            const cart = useCart();
            // Mutate AFTER ssrState registered — the live toJSON registration
            // must capture this in the emitted blob.
            cart.addItem('book', 12);
            return () => <div class="cart">{(cart as any).items.length}</div>;
        }, { name: 'Page' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        const html = await ssr.render((Page as any)({}));

        expect(html).toContain('<div class="cart">1</div>');
        expect(html).toContain(`"store:${name}"`);
        expect(html).toContain('"items":["book"]');
        expect(html).toContain('"total":12');
    });

    it('pick limits the serialized keys', async () => {
        const name = nextName();
        const useCart = makeCartStore(name, { pick: ['items', 'total'] });

        const Page = component(() => {
            const cart = useCart();
            cart.addItem('pen', 3);
            return () => <div>x</div>;
        }, { name: 'Page' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        const html = await ssr.render((Page as any)({}));

        expect(html).toContain(`"store:${name}"`);
        expect(html).toContain('"items":["pen"]');
        expect(html).not.toContain('internalCursor');
        expect(html).not.toContain('not-for-the-wire');
    });

    it('warns in dev when an INSTANCE-scoped store name registers twice in one request', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        // transient: each use() = new instance
        const useCart = makeCartStore(name, { scope: 'instance' });

        const A = component(() => { useCart(); return () => <i>a</i>; }, { name: 'A' });
        const B = component(() => { useCart(); return () => <i>b</i>; }, { name: 'B' });
        const Page = component(() => () => <div>{(A as any)({})}{(B as any)({})}</div>, { name: 'Page' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        await ssr.render((Page as any)({}));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`ssrState: "${name}" registered twice`));
        warn.mockRestore();
    });

    it('does NOT warn for a shared store — several instances describe the same runtime state', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        const useCart = makeCartStore(name); // shared is the default

        const A = component(() => { useCart(); return () => <i>a</i>; }, { name: 'A' });
        const B = component(() => { useCart(); return () => <i>b</i>; }, { name: 'B' });
        const Page = component(() => () => <div>{(A as any)({})}{(B as any)({})}</div>, { name: 'Page' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        await ssr.render((Page as any)({}));

        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('registered twice'));
        warn.mockRestore();
    });
});

describe('ssrState — client seeding', () => {
    it('seeds EVERY instance from the blob (#70) and leaves the entry in place', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: { items: ['from-server'], total: 99 }
        };

        const useCart = makeCartStore(name);

        // Outside any render/component → client path
        const first = useCart() as any;
        expect(first.items).toEqual(['from-server']);
        expect(first.total).toBe(99);
        expect(first.internalCursor).toBe('not-for-the-wire'); // unkeyed default kept
        expect(first.$ssr.hydrated).toBe(true);

        // The entry is the runtime's, for its lifetime: a SECOND instance —
        // island #2, an upgraded boundary, a remount — seeds from it too.
        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(true);
        const second = useCart() as any;
        expect(second.items).toEqual(['from-server']);
        expect(second.total).toBe(99);
        expect(second.$ssr.hydrated).toBe(true);
    });

    it('gives each instance its own copy — no shared mutable substructure', () => {
        const name = nextName();
        const key = `store:${name}`;
        (globalThis as any).__SIGX_ASYNC__ = { [key]: { items: ['a'], total: 1 } };

        const useCart = makeCartStore(name);

        const first = useCart() as any;
        // A deep mutation through the reactive proxy must not write through to
        // the blob entry, and so must not reach any later instance.
        first.items.push('mutated-by-first');

        expect((globalThis as any).__SIGX_ASYNC__[key].items).toEqual(['a']);
        const second = useCart() as any;
        expect(second.items).toEqual(['a']);
    });

    it("scope: 'instance' restores consume-once", () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: { items: ['from-server'], total: 99 }
        };

        const useCart = makeCartStore(name, { scope: 'instance' });

        const first = useCart() as any;
        expect(first.items).toEqual(['from-server']);
        expect(first.$ssr.hydrated).toBe(true);

        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(false);
        const second = useCart() as any;
        expect(second.items).toEqual([]);
        expect(second.$ssr.hydrated).toBe(false);
    });

    it('copies without structuredClone when a JSON round-trip is lossless', () => {
        const name = nextName();
        const key = `store:${name}`;
        (globalThis as any).__SIGX_ASYNC__ = { [key]: { items: ['a'], total: 1 } };
        vi.stubGlobal('structuredClone', undefined);

        const useCart = makeCartStore(name);
        const first = useCart() as any;
        first.items.push('mutated-by-first');

        expect((globalThis as any).__SIGX_ASYNC__[key].items).toEqual(['a']);
        expect((useCart() as any).items).toEqual(['a']);
    });

    it('treats a sparse array as not JSON-copyable (holes serialize as null)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        const sparse: string[] = [];
        sparse[2] = 'third';                       // holes at 0 and 1
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: sparse } };
        vi.stubGlobal('structuredClone', undefined);

        makeCartStore(name)();

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(`"${name}" could not copy its server seed`)
        );
        warn.mockRestore();
    });

    it('shares a rich seed by reference rather than flattening it through JSON', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        const useStore = defineStore(name, (ctx) => {
            const { state, signals, patch } = ctx.defineState({ updatedAt: null as Date | null });
            const handle = ssrState(ctx, { state, patch });
            return { ...signals, $ssr: handle };
        }, 'transient');

        const ms = Date.UTC(2026, 6, 23);
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { updatedAt: { $date: ms } } };
        // A runtime with no structuredClone: the JSON fallback would turn the
        // revived Date into a string, which is worse than sharing it.
        vi.stubGlobal('structuredClone', undefined);

        const store = useStore() as any;

        expect(store.updatedAt).toBeInstanceOf(Date);
        expect((store.updatedAt as Date).getTime()).toBe(ms);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(`"${name}" could not copy its server seed`)
        );
        warn.mockRestore();
    });

    it('revives rich types through core codec (a $date tag arrives as a Date)', () => {
        const name = nextName();
        const useStore = defineStore(name, (ctx) => {
            const { state, signals, patch } = ctx.defineState({ updatedAt: null as Date | null });
            const handle = ssrState(ctx, { state, patch });
            return { ...signals, $ssr: handle };
        }, 'transient');

        const ms = Date.UTC(2026, 6, 23);
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { updatedAt: { $date: ms } } };

        const store = useStore() as any;
        expect(store.updatedAt).toBeInstanceOf(Date);
        expect((store.updatedAt as Date).getTime()).toBe(ms);
        // The copy taken per instance must not flatten it back to a string.
        const second = useStore() as any;
        expect(second.updatedAt).toBeInstanceOf(Date);
    });

    it('pick filters the applied seed', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: { items: ['x'], total: 5, internalCursor: 'INJECTED' }
        };

        const useCart = makeCartStore(name, { pick: ['items'] });
        const cart = useCart() as any;

        expect(cart.items).toEqual(['x']);
        expect(cart.total).toBe(0);                      // not picked → default
        expect(cart.internalCursor).toBe('not-for-the-wire'); // not picked → default
    });

    it('no blob entry → defaults, hydrated false', () => {
        const name = nextName();
        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual([]);
        expect(cart.$ssr.hydrated).toBe(false);
    });

    it('seeds from window.__SIGX_ASYNC__ (the surface the server emits)', () => {
        const name = nextName();
        // The server writes `window.__SIGX_ASYNC__=…`; reading must find it
        // there even when `window` is not the same object as `globalThis`.
        (window as any).__SIGX_ASYNC__ = { [`store:${name}`]: { items: ['from-window'] } };

        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual(['from-window']);
        expect(cart.$ssr.hydrated).toBe(true);
    });

    it('ignores non-object seeds defensively', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: 'garbage' };
        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual([]);
        expect(cart.$ssr.hydrated).toBe(false);
    });

    it('drops unknown keys from the seed', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: { items: ['ok'], injected: 'nope' }
        };

        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual(['ok']);
        expect(cart.injected).toBeUndefined();
        expect(cart.$ssr.hydrated).toBe(true);
    });

    it('a __proto__-tampered seed is sanitized by the codec: the key is dropped, the rest applies', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: JSON.parse(
                '{"items":["ok"],"injected":"nope","__proto__":{"polluted":true}}'
            )
        };

        const cart = makeCartStore(name)() as any;

        // Since core 0.15 (signalxjs/core#592) revive DROPS an own "__proto__"
        // key at the codec instead of rebuilding it by assignment — which used
        // to swap the revived object's prototype, the shape `isPlainSeed`
        // rejected wholesale under core ≤0.14. The seed now arrives as a plain
        // record with the dangerous key already gone, so the remaining keys go
        // through the slice allow-list as usual. Object.prototype is untouched
        // on every path.
        expect(cart.items).toEqual(['ok']);
        expect(cart.injected).toBeUndefined();
        expect(cart.$ssr.hydrated).toBe(true);
        expect(({} as any).polluted).toBeUndefined(); // Object.prototype untouched
        expect((cart as any).polluted).toBeUndefined(); // …and so is the state's
    });

    it('ignores a non-plain-object seed instead of reporting a no-op hydration', () => {
        const name = nextName();
        // A hand-written blob entry the codec revives into a Date: it has no
        // slice keys, so patching it would apply nothing while claiming success.
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: { $date: Date.UTC(2026, 6, 23) } };

        const cart = makeCartStore(name)() as any;

        expect(cart.items).toEqual([]);
        expect(cart.$ssr.hydrated).toBe(false);
    });

    it('accepts a null-prototype seed', () => {
        const name = nextName();
        const seed = Object.assign(Object.create(null), { items: ['np'], total: 2 });
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: seed };

        const cart = makeCartStore(name)() as any;

        expect(cart.items).toEqual(['np']);
        expect(cart.$ssr.hydrated).toBe(true);
    });

    it('ignores array seeds (numeric keys must not be assigned onto the state)', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: ['a', 'b'] };
        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual([]);
        expect((cart as any)['0']).toBeUndefined();
        expect(cart.$ssr.hydrated).toBe(false);
    });
});

describe('ssrState — reserved keys', () => {
    it('a caller-supplied pick cannot smuggle reserved keys into the patch', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: JSON.parse('{"items":["ok"],"__proto__":{"polluted":true}}')
        };

        const useCart = makeCartStore(name, { pick: ['items', '__proto__'] as any });
        const cart = useCart() as any;

        // Naming a reserved key in `pick` buys nothing: the codec drops an own
        // "__proto__" key during revive (core 0.15, signalxjs/core#592), and
        // the allow-list excludes reserved keys anyway — so only the
        // legitimate picked keys reach patch().
        expect(cart.items).toEqual(['ok']);
        expect(({} as any).polluted).toBeUndefined();
        expect(cart.$ssr.hydrated).toBe(true);
    });

    it('a caller-supplied pick cannot smuggle reserved keys into the SERVER snapshot', async () => {
        const name = nextName();
        // `pick` feeds snapshot() directly on the server, so the reserved-key
        // guard there is load-bearing in its own right.
        const useCart = makeCartStore(name, { pick: ['items', '__proto__'] as any });

        const Page = component(() => {
            const cart = useCart();
            cart.addItem('pen', 3);
            return () => <div>x</div>;
        }, { name: 'Page' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        const html = await ssr.render((Page as any)({}));

        expect(html).toContain('"items":["pen"]');
        expect(html).not.toContain('__proto__');
        expect(({} as any).polluted).toBeUndefined();
    });
});

describe('ssrState — pick is intersected with real slice keys', () => {
    it('a pick entry for a key the slice does not have is never patched', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: { items: ['ok'], notASliceKey: 'INJECTED' }
        };

        const useCart = makeCartStore(name, { pick: ['items', 'notASliceKey'] as any });
        const cart = useCart() as any;

        expect(cart.items).toEqual(['ok']);
        expect(cart.notASliceKey).toBeUndefined();
    });
});

describe('ssrState — full round trip', () => {
    it('server render → blob → client store matches the server state', async () => {
        const name = nextName();
        const useCart = makeCartStore(name);

        const Page = component(() => {
            const cart = useCart();
            cart.addItem('lamp', 40);
            cart.addItem('rug', 60);
            return () => <div>{(cart as any).total}</div>;
        }, { name: 'Page' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        const html = await ssr.render((Page as any)({}));

        // "Execute" the blob script the way a browser would
        const marker = 'window.__SIGX_ASYNC__,';
        const json = html.slice(
            html.indexOf(marker) + marker.length,
            html.lastIndexOf(');</script>')
        );
        (globalThis as any).__SIGX_ASYNC__ = JSON.parse(json);

        const client = useCart() as any;
        expect(client.items).toEqual(['lamp', 'rug']);
        expect(client.total).toBe(100);
        expect(client.$ssr.hydrated).toBe(true);
    });
});

/**
 * Streaming: a store first resolved BELOW a streamed boundary registers after
 * the shell's state script is already flushed. Core 0.13 (#407) drains a
 * request-level dirty set at every emission point, so that registration ships
 * in the boundary's own chunk instead of being dropped — the failure mode that
 * made island/boundary stores hydrate from defaults with nothing said.
 */
describe('ssrState — registration below a streamed boundary', () => {
    it('still reaches the client, in a later chunk', async () => {
        const name = nextName();
        const useCart = makeCartStore(name);

        // The store is resolved in a CHILD of the async component, so its
        // setup runs while the shell is long gone.
        const Inner = component(() => {
            const cart = useCart();
            cart.addItem('streamed', 7);
            return () => <span>{(cart as any).total}</span>;
        }, { name: 'Inner' });

        const Deferred = component(() => {
            const data = useData(`stream-probe-${name}`, () => Promise.resolve('ready'));
            return () => data.match({
                pending: () => <p>loading</p>,
                ready: () => <div>{(Inner as any)({})}</div>,
                errored: () => <p>error</p>
            });
        }, { name: 'Deferred' });

        const ssr = createSSR({ plugins: [stateSerializationPlugin()] });
        const chunks: string[] = [];
        for await (const chunk of ssr.renderChunks((Deferred as any)({}))) chunks.push(chunk);
        const html = chunks.join('');

        // Proves the LATE path delivered it: the shell chunk cannot contain a
        // key that had not been registered when it was written.
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0]).not.toContain(`"store:${name}"`);
        expect(chunks.slice(1).join('')).toContain(`"store:${name}"`);
        expect(html).toContain(`"store:${name}"`);
        expect(html).toContain('"items":["streamed"]');
        expect(html).toContain('"total":7');
    });
});
