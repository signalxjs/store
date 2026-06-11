/**
 * ssrState() — SSR state transfer for stores.
 *
 * Server side is integration-tested against the REAL @sigx/server-renderer
 * (devDep): a component resolves a store during render, ssrState registers
 * the live slice, and stateSerializationPlugin emits it into the
 * __SIGX_ASYNC__ blob under `store:<name>`. Client side seeds from the blob
 * via one atomic patch, consume-once.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { component } from 'sigx';
import { createSSR, stateSerializationPlugin } from '@sigx/server-renderer';
import { defineStore } from '../src/store';
import { ssrState } from '../src/ssr';

let storeCounter = 0;
const nextName = () => `ssrStore_${++storeCounter}`;

afterEach(() => {
    delete (globalThis as any).__SIGX_ASYNC__;
});

function makeCartStore(name: string, opts?: { pick?: any }) {
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

        const ssr = createSSR().use(stateSerializationPlugin());
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

        const ssr = createSSR().use(stateSerializationPlugin());
        const html = await ssr.render((Page as any)({}));

        expect(html).toContain(`"store:${name}"`);
        expect(html).toContain('"items":["pen"]');
        expect(html).not.toContain('internalCursor');
        expect(html).not.toContain('not-for-the-wire');
    });

    it('warns in dev when the same store name registers twice in one request', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const name = nextName();
        const useCart = makeCartStore(name); // transient: each use() = new instance

        const A = component(() => { useCart(); return () => <i>a</i>; }, { name: 'A' });
        const B = component(() => { useCart(); return () => <i>b</i>; }, { name: 'B' });
        const Page = component(() => () => <div>{(A as any)({})}{(B as any)({})}</div>, { name: 'Page' });

        const ssr = createSSR().use(stateSerializationPlugin());
        await ssr.render((Page as any)({}));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"${name}" registered twice`));
        warn.mockRestore();
    });
});

describe('ssrState — client seeding', () => {
    it('seeds the slice from the blob with one patch, consume-once', () => {
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

        // Consume-once: the blob entry is gone; a SECOND instance must start
        // from defaults instead of forking from the seed
        expect(`store:${name}` in (globalThis as any).__SIGX_ASYNC__).toBe(false);
        const second = useCart() as any;
        expect(second.items).toEqual([]);
        expect(second.$ssr.hydrated).toBe(false);
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

    it('ignores non-object seeds defensively', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = { [`store:${name}`]: 'garbage' };
        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual([]);
        expect(cart.$ssr.hydrated).toBe(false);
    });

    it('drops unknown/tampered keys from the seed (incl. __proto__-style)', () => {
        const name = nextName();
        (globalThis as any).__SIGX_ASYNC__ = {
            [`store:${name}`]: JSON.parse(
                '{"items":["ok"],"injected":"nope","__proto__":{"polluted":true}}'
            )
        };

        const cart = makeCartStore(name)() as any;
        expect(cart.items).toEqual(['ok']);
        expect(cart.injected).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined(); // Object.prototype untouched
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

        expect(cart.items).toEqual(['ok']);
        expect(({} as any).polluted).toBeUndefined();
        expect(cart.$ssr.hydrated).toBe(true);
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

        const ssr = createSSR().use(stateSerializationPlugin());
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
