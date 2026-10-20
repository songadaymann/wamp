import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatAdminPicker } from './chatAdminPicker';
import type { ChatMentionUserListResponse, ChatMentionUserRecord } from '../../chat/model';
class Element extends EventTarget {
  value = ''; disabled = false; textContent = ''; className = ''; type = ''; children: Element[] = [];
  focus = vi.fn();
  replaceChildren() { this.children = []; }
  appendChild(child: Element) { this.children.push(child); }
  click() { this.dispatchEvent(new Event('click')); }
}
const first: ChatMentionUserRecord = { userId: 'first-id', displayName: 'Shared name', username: 'first_account' };
const second: ChatMentionUserRecord = { userId: 'second-id', displayName: 'Shared name', username: 'second_account' };
const pickers: ChatAdminPicker[] = [];
function setup() {
  const input = new Element(), results = new Element(), status = new Element();
  const search = vi.fn(async (_query: string, _options: { signal?: AbortSignal } = {}): Promise<ChatMentionUserListResponse> => ({ users: [first, second] }));
  const changed = vi.fn();
  const picker = new ChatAdminPicker({ doc: { createElement: () => new Element() } as unknown as Document,
    input: input as unknown as HTMLInputElement, results: results as unknown as HTMLElement,
    status: status as unknown as HTMLElement, search, changed });
  picker.init(); picker.setEnabled(true); pickers.push(picker);
  const type = (value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
  return { picker, input, results, status, search, changed, type };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const p of pickers.splice(0)) p.destroy(); vi.useRealTimers(); });
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
describe('chat admin account selection lifecycle', () => {
  it('coalesces typing, displays both handles, selects the exact ID and invalidates changed input', async () => {
    const f = setup(); f.type('Sh'); f.type('Shared name');
    await vi.advanceTimersByTimeAsync(199); expect(f.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.search).toHaveBeenCalledOnce();
    expect(f.results.children.map(c => c.textContent)).toEqual(['Shared name (@first_account)', 'Shared name (@second_account)']);
    expect(f.picker.getSelection()).toBeNull();
    f.results.children[1].click(); expect(f.picker.getSelection()?.userId).toBe('second-id');
    f.picker.setEnabled(false); f.picker.setEnabled(true);
    expect(f.status.textContent).toBe('Selected: Shared name (@second_account)');
    expect(f.input.focus).toHaveBeenCalled(); expect(f.results.children).toEqual([]);
    f.input.value = 'A changed value'; expect(f.picker.getSelection()).toBeNull();
    f.type('Shared name (@second_account)'); expect(f.picker.getSelection()).toBeNull();
  });
  it('ignores an older search even when its transport does not honor cancellation', async () => {
    const f = setup(); let resolve!: (r: ChatMentionUserListResponse) => void;
    f.search.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.type('old'); await vi.advanceTimersByTimeAsync(200);
    const signal = f.search.mock.calls[0][1]?.signal; expect(signal?.aborted).toBe(false);
    f.type('new'); f.search.mockResolvedValueOnce({ users: [second] });
    expect(signal?.aborted).toBe(true); await vi.advanceTimersByTimeAsync(200);
    resolve({ users: [first] }); await tick();
    expect(f.results.children.map(c => c.textContent)).toEqual(['Shared name (@second_account)']);
  });
  it('cancels closed/disabled work and ignores late results and failures', async () => {
    const f = setup(); f.type('cancel-before-send'); f.picker.setEnabled(false);
    await vi.advanceTimersByTimeAsync(1000); expect(f.search).not.toHaveBeenCalled();
    f.picker.setEnabled(true); let resolve!: (r: ChatMentionUserListResponse) => void;
    f.search.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.type('cancel-after-send'); await vi.advanceTimersByTimeAsync(200); f.picker.setEnabled(false); f.picker.clear();
    resolve({ users: [first] }); await tick();
    expect(f.results.children).toEqual([]); expect(f.picker.getSelection()).toBeNull();
    expect(f.status.textContent).toBe(''); expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers from failed and empty searches and removes input listeners on destruction', async () => {
    const f = setup(); f.search.mockRejectedValueOnce(new Error('offline')); f.type('first');
    await vi.advanceTimersByTimeAsync(200); expect(f.status.textContent).toBe('Search failed. Try again.');
    f.search.mockResolvedValueOnce({ users: [] }); f.type('none');
    await vi.advanceTimersByTimeAsync(200); expect(f.status.textContent).toBe('No matching accounts.');
    f.type('Shared'); await vi.advanceTimersByTimeAsync(200); expect(f.results.children).toHaveLength(2);
    f.picker.destroy(); const count = f.search.mock.calls.length; f.type('ignored');
    await vi.advanceTimersByTimeAsync(1000); expect(f.search).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  });
  it('renders identity strings as text and never needs an HTML parser', async () => {
    const f = setup(); f.search.mockResolvedValueOnce({ users: [{ ...second, displayName: '<img src=x onerror=bad()>' }] });
    f.type('second'); await vi.advanceTimersByTimeAsync(200);
    expect(f.results.children[0].textContent).toBe('<img src=x onerror=bad()> (@second_account)');
    expect(f.results.children[0].children).toEqual([]);
  });
});
