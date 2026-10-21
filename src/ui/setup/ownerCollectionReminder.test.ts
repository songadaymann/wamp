import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerCollectionReminder, loadCollectionPrice, type CollectionPrice } from './ownerCollectionReminder';
const quote: CollectionPrice = { priceWei: '10000000000000000', chainId: 8453,
  contractAddress: `0x${'1'.repeat(40)}`, quotedAt: new Date().toISOString() };
const room = { roomId: '0,0', userId: 'builder', expanded: false };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(gate = true) {
  class Element extends EventTarget {
    textContent = ''; hidden = true;
    classList = { toggle: (_name: string, hide: boolean) => { this.hidden = hide; } };
  }
  const root = new Element(), text = new Element(), action = new Element(), win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: { wallet: gate ? 'yes' : 'no' } },
    defaultView: win, getElementById: (id: string) => ({ 'owner-collection-reminder': root, 'owner-collection-price': text, 'btn-owner-collection': action })[id] });
  const load = vi.fn(async (_signal: AbortSignal) => quote), open = vi.fn();
  const controller = new OwnerCollectionReminder(doc as unknown as Document, open, load);
  return { controller, doc, root, text, action, win, load, open };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('owner reminder lifecycle', () => {
  it('fetches once per selection and opens only the editor; no repeated idle work', async () => {
    const f = fixture(); f.controller.update(room); await flush();
    expect(f.root.hidden).toBe(false); expect(f.text.textContent).toContain('0.01 ETH on Base');
    for (let i = 0; i < 100; i++) f.controller.update(room);
    expect(f.load).toHaveBeenCalledOnce(); f.action.dispatchEvent(new Event('click')); expect(f.open).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it('keeps one in-flight quote when Expanded membership arrives for the same cell', async () => {
    const f = fixture(); let resolve!: (q: CollectionPrice) => void;
    f.load.mockImplementation(() => new Promise(r => { resolve = r; }));
    f.controller.update(room); f.controller.update({ ...room, expanded: true });
    expect(f.load).toHaveBeenCalledOnce(); expect(f.load.mock.calls[0][0].aborted).toBe(false);
    resolve(quote); await flush(); expect(f.text.textContent).toContain('per cell');
    f.controller.update(room); expect(f.text.textContent).toContain('this room'); expect(f.text.textContent).not.toContain('per cell');
    f.controller.destroy();
  });
  it('never fetches or opens without the wallet gate or owner context', async () => {
    const f = fixture(false); f.controller.update(room); await flush(); f.action.dispatchEvent(new Event('click'));
    expect(f.load).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(f.root.hidden).toBe(true); f.controller.destroy();
  });
  it('reuses the bounded quote across Expanded cells and makes cell pricing explicit', async () => {
    const f = fixture(); f.controller.update(room); await flush(); f.controller.update({ ...room, roomId: '1,0', expanded: true });
    expect(f.load).toHaveBeenCalledOnce(); expect(f.text.textContent).toContain('this cell'); expect(f.text.textContent).toContain('per cell'); f.controller.destroy();
  });
  it.each(['gate', 'auth', 'hidden', 'selection', 'destroy'])('aborts and ignores late reads on %s', async why => {
    const f = fixture(); let resolve!: (q: CollectionPrice) => void;
    f.load.mockImplementation(() => new Promise(r => { resolve = r; })); f.controller.update(room);
    const signal = f.load.mock.calls[0][0];
    if (why === 'gate') { f.doc.documentElement.dataset.wallet = 'no'; f.win.dispatchEvent(new Event('wallet-gate')); }
    if (why === 'auth') f.win.dispatchEvent(new Event('auth-state-changed'));
    if (why === 'hidden') { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); }
    if (why === 'selection') f.controller.update(null);
    if (why === 'destroy') f.controller.destroy();
    expect(signal.aborted).toBe(true); resolve(quote); await flush(); expect(f.root.hidden).toBe(true);
    f.action.dispatchEvent(new Event('click')); expect(f.open).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it('shows unavailable instead of a guessed price and does not retry in the background', async () => {
    const f = fixture(); f.load.mockRejectedValue(new Error('RPC unavailable')); f.controller.update(room); await flush();
    expect(f.text.textContent).toContain('unavailable'); f.controller.update(room); expect(f.load).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it('disposes and unregisters listeners', async () => {
    const f = fixture(); f.controller.update(room); await flush(); f.controller.destroy();
    f.action.dispatchEvent(new Event('click')); f.win.dispatchEvent(new Event('wallet-gate'));
    expect(f.open).not.toHaveBeenCalled(); expect(f.root.hidden).toBe(true);
  });
});
describe('price client validation', () => {
  it('uses a credential-free GET and accepts zero as a real price', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ...quote, priceWei: '0' })); vi.stubGlobal('fetch', fetch);
    expect((await loadCollectionPrice(new AbortController().signal)).priceWei).toBe('0');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  });
  it.each([{ priceWei: '-1' }, { priceWei: '001' }, { priceWei: (2n ** 256n).toString() }, { chainId: 1 }, { quotedAt: '' }, { contractAddress: '' }])('rejects malformed quote %j', async change => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...quote, ...change })));
    await expect(loadCollectionPrice(new AbortController().signal)).rejects.toThrow();
  });
});
