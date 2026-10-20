import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './roomWalletTestFixtures';

function fixture(search: string) {
  vi.resetModules();
  const root = { dataset: {} as Record<string, string> }, browser = new EventTarget();
  vi.stubGlobal('window', browser); vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', memoryStorage());
  return { root, browser };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('installed-wallet visibility gate', () => {
  it.each(['0', '1'])('honors crypto=%s even if browser storage is blocked', async value => {
    const f = fixture(`?crypto=${value}`);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } });
    const { applyWalletGate } = await import('../lib/wallet-gate.js');
    expect((await applyWalletGate()).hasWallet).toBe(value === '1'); expect(f.root.dataset.wallet).toBe(value === '1' ? 'yes' : 'no');
  });
  it.each(['0', '1'])('supports the explicit crypto=%s state without contacting a wallet', async value => {
    const f = fixture(`?crypto=${value}`), request = vi.fn(); Object.assign(f.browser, { ethereum: { request } });
    const { applyWalletGate } = await import('../lib/wallet-gate.js');
    expect((await applyWalletGate()).hasWallet).toBe(value === '1');
    expect(f.root.dataset.wallet).toBe(value === '1' ? 'yes' : 'no'); expect(request).not.toHaveBeenCalled();
  });
  it('detects an installed wallet using announcements without connecting or reading its address', async () => {
    vi.useFakeTimers(); const f = fixture('?crypto=auto'), request = vi.fn(() => { throw new Error('Must not connect'); });
    Object.assign(f.browser, { ethereum: { request } });
    const { applyWalletGate } = await import('../lib/wallet-gate.js'); const work = applyWalletGate();
    f.browser.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'Test installed wallet', rdns: 'test.wallet' }, provider: { request } } }));
    await vi.advanceTimersByTimeAsync(600); expect(await work).toMatchObject({ hasWallet: true, names: ['Test installed wallet'] });
    expect(f.root.dataset.wallet).toBe('yes'); expect(request).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('leaves a browser without an installed wallet off and clears an earlier override with crypto=auto', async () => {
    vi.useFakeTimers(); const f = fixture('?crypto=auto'); localStorage.setItem('crypto-override', '1');
    const { applyWalletGate } = await import('../lib/wallet-gate.js'); const work = applyWalletGate();
    await vi.advanceTimersByTimeAsync(600); expect((await work).hasWallet).toBe(false);
    expect(f.root.dataset.wallet).toBe('no'); expect(localStorage.getItem('crypto-override')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
