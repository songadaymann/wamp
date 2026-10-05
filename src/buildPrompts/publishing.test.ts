import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: { id: 'builder' }, schoolManaged: false, world: null as string | null }));
vi.mock('../auth/client', () => ({ getAuthDebugState: () => state }));
vi.mock('../worlds/clientContext', () => ({ getActiveWorldId: () => state.world }));
import { prepareBuildPromptEntry, completeBuildPromptEntry, BUILD_PROMPT_PUBLISH_REQUEST, BUILD_PROMPT_ENTRY_RESULT, type PromptPublishRequest, type PromptEntryResult } from './publishing';
import type { BuildPromptRepository } from './repository';
import type { BuildPrompt } from './model';
const prompt: BuildPrompt = { slug: 'fixture-week', title: 'Fixture theme', constraint: 'One jump.', startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z', settledAt: null, entryCount: 0 };
function fixture() {
  const win = new EventTarget();
  const repository = { current: vi.fn(async () => ({ prompt: null as BuildPrompt | null, serverTime: prompt.startsAt })), enter: vi.fn(async () => ({})), load: vi.fn(), withdraw: vi.fn() };
  return { win: win as Window, repository: repository as unknown as BuildPromptRepository, mocks: repository };
}
beforeEach(() => { state.user.id = 'builder'; state.schoolManaged = false; state.world = null; });
afterEach(() => vi.restoreAllMocks());
describe('optional prompt entry at publication', () => {
  it('has no extra dialog or mutation without a prompt and preserves guest/private/classroom publication', async () => {
    const f = fixture(), request = vi.fn(); f.win.addEventListener(BUILD_PROMPT_PUBLISH_REQUEST, request);
    expect(await prepareBuildPromptEntry('builder', 'room:0,0', f.repository, f.win)).toEqual({ slug: null });
    expect(request).not.toHaveBeenCalled(); expect(f.mocks.enter).not.toHaveBeenCalled();
    state.world = 'private'; await prepareBuildPromptEntry('builder', 'room:0,0', f.repository, f.win);
    state.world = null; state.schoolManaged = true; await prepareBuildPromptEntry('builder', 'room:0,0', f.repository, f.win);
    state.schoolManaged = false; await prepareBuildPromptEntry(null, 'room:0,0', f.repository, f.win);
    expect(f.mocks.current).toHaveBeenCalledOnce();
  });
  it('asks for an explicit checkbox choice and cancellation stops publication', async () => {
    const f = fixture(); f.mocks.current.mockResolvedValue({ prompt, serverTime: prompt.startsAt });
    f.win.addEventListener(BUILD_PROMPT_PUBLISH_REQUEST, event => { event.preventDefault(); (event as CustomEvent<PromptPublishRequest>).detail.resolve(null); });
    expect(await prepareBuildPromptEntry('builder', 'room:0,0', f.repository, f.win)).toBeNull();
  });
  it('shows a failed prompt read so publishing can continue without claiming entry', async () => {
    const f = fixture(); f.mocks.current.mockRejectedValue(new Error('offline'));
    const request = vi.fn((event: Event) => { event.preventDefault(); const detail = (event as CustomEvent<PromptPublishRequest>).detail; expect(detail.loadError).toBe(true); expect(detail.prompt).toBeNull(); detail.resolve({ slug: null }); });
    f.win.addEventListener(BUILD_PROMPT_PUBLISH_REQUEST, request);
    expect(await prepareBuildPromptEntry('builder', 'room:0,0', f.repository, f.win)).toEqual({ slug: null }); expect(request).toHaveBeenCalledOnce();
  });
  it('discards a late prompt read after account change', async () => {
    const f = fixture(); let resolve!: (value: { prompt: BuildPrompt; serverTime: string }) => void;
    f.mocks.current.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = prepareBuildPromptEntry('builder', 'room:0,0', f.repository, f.win); state.user.id = 'other'; resolve({ prompt, serverTime: prompt.startsAt });
    expect(await pending).toBeNull();
  });
  it('reports partial failure and retries the saved version, without republishing or changing identity', async () => {
    const f = fixture(), results: PromptEntryResult[] = [];
    f.mocks.enter.mockRejectedValueOnce(new Error('offline'));
    f.win.addEventListener(BUILD_PROMPT_ENTRY_RESULT, event => { results.push((event as CustomEvent<PromptEntryResult>).detail); });
    await completeBuildPromptEntry({ slug: prompt.slug }, 'builder', 'expanded_room:course:level', 7, 'Saved level', f.repository, f.win);
    expect(results[0].error).toBe('offline'); await results[0].retry(); expect(results[1].error).toBeNull();
    expect(f.mocks.enter.mock.calls).toEqual([[prompt.slug, 'expanded_room:course:level', 7], [prompt.slug, 'expanded_room:course:level', 7]]);
    state.user.id = 'other'; await results[0].retry(); expect(f.mocks.enter).toHaveBeenCalledTimes(2);
  });
  it('does not submit an unchecked choice', async () => {
    const f = fixture(); await completeBuildPromptEntry({ slug: null }, 'builder', 'room:0,0', 1, 'Saved', f.repository, f.win); expect(f.mocks.enter).not.toHaveBeenCalled();
  });
});
