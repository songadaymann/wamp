import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: { id: 'builder' } }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', AUTH_SESSION_REFRESHED_EVENT: 'session', getAuthDebugState: () => auth }));
vi.mock('../../worlds/clientContext', () => ({ getActiveWorldId: () => null }));
import { BuildPromptsController } from './buildPrompts';
import { BUILD_PROMPT_ENTRY_RESULT, BUILD_PROMPT_PUBLISH_REQUEST, type PromptPublishRequest } from '../../buildPrompts/publishing';
import type { BuildPrompt, BuildPromptEntry, BuildPromptsResponse } from '../../buildPrompts/model';
import { ROOM_SEQUENCE_START_EVENT } from './roomSequenceEvents';
class Element extends EventTarget {
  classes = new Set(['hidden']); classList = { contains: (name: string) => this.classes.has(name), add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), toggle: (name: string, force: boolean) => force ? this.classes.add(name) : this.classes.delete(name) };
  value = ''; textContent = ''; checked = false; disabled = false; dataset: Record<string, string> = {}; children: Element[] = []; isConnected = true;
  focus = vi.fn(); setAttribute = vi.fn(); getClientRects = () => [{}]; querySelectorAll = () => [];
  replaceChildren() { this.children = []; } append(...elements: Element[]) { this.children.push(...elements); } click() { this.dispatchEvent(new Event('click')); }
}
const prompt: BuildPrompt = { slug: 'fixture-week', title: 'Fixture theme', constraint: 'One jump.', startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z', settledAt: null, entryCount: 1 };
const entry: BuildPromptEntry = { targetKey: 'room:0,0', contentType: 'room', contentId: '0,0', version: 3, roomId: '0,0', roomVersion: 3, coordinates: { x: 0, y: 0 }, title: 'Saved title', builderUserId: 'builder', builderDisplayName: 'Builder', cellCount: 1, legacyCourseId: null, available: true, voteCount: 1, adjustedAverage: 3.75, winnerRank: null, submittedAt: prompt.startsAt };
const empty: BuildPromptsResponse = { serverTime: prompt.startsAt, current: null, prompt: null, recent: [], entries: [], viewerEntry: null, nextOffset: null };
const controllers: BuildPromptsController[] = [];
function fixture() {
  const elements = new Map<string, Element>(); const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'world' } }, activeElement: new Element(), getElementById: get, createElement: () => new Element() });
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const repository = { current: vi.fn(), load: vi.fn(async (): Promise<BuildPromptsResponse> => empty), enter: vi.fn(), withdraw: vi.fn(async () => {}) };
  const closeExplore = vi.fn(); const controller = new BuildPromptsController(closeExplore, doc as unknown as Document, win as unknown as Window, repository);
  vi.stubGlobal('HTMLElement', Element); controller.init(); controllers.push(controller);
  return { get, doc, win, repository, controller, closeExplore };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => { auth.user.id = 'builder'; });
afterEach(() => { for (const c of controllers.splice(0)) c.destroy(); vi.unstubAllGlobals(); });
describe('Build Prompt public and publishing lifecycle', () => {
  it('loads only when opened, shows the honest empty state and offers Refresh after a read failure', async () => {
    const f = fixture(); expect(f.repository.load).not.toHaveBeenCalled(); f.get('btn-explore-build-prompt').click(); await tick();
    expect(f.closeExplore).toHaveBeenCalledOnce(); expect(f.get('build-prompt-constraint').textContent).toContain('No prompt scheduled yet'); expect(f.get('btn-build-prompt-play-all').disabled).toBe(true);
    f.repository.load.mockRejectedValueOnce(new Error('offline')); f.get('btn-build-prompt-refresh').click(); await tick(); expect(f.get('build-prompt-status').textContent).toContain('Try Refresh'); expect(f.get('btn-build-prompt-refresh').disabled).toBe(false);
  });
  it('keeps the checkbox optional and resolves cancellation exactly once on identity change', () => {
    const f = fixture(), resolve = vi.fn();
    f.win.dispatchEvent(new CustomEvent<PromptPublishRequest>(BUILD_PROMPT_PUBLISH_REQUEST, { cancelable: true, detail: { userId: 'builder', targetKey: entry.targetKey, prompt, loadError: false, resolve } }));
    expect(f.get('build-prompt-enter').checked).toBe(false); f.get('build-prompt-enter').checked = true;
    f.get('build-prompt-publish-form').dispatchEvent(new Event('submit', { cancelable: true })); expect(resolve).toHaveBeenCalledExactlyOnceWith({ slug: prompt.slug });
    const next = vi.fn(); f.win.dispatchEvent(new CustomEvent<PromptPublishRequest>(BUILD_PROMPT_PUBLISH_REQUEST, { cancelable: true, detail: { userId: 'builder', targetKey: entry.targetKey, prompt, loadError: false, resolve: next } }));
    auth.user.id = 'other'; f.win.dispatchEvent(new Event('auth')); expect(next).toHaveBeenCalledExactlyOnceWith(null); f.controller.destroy(); expect(next).toHaveBeenCalledOnce();
  });
  it('cannot opt in when the prompt read failed, even with a stale checked input', () => {
    const f = fixture(), resolve = vi.fn(); f.win.dispatchEvent(new CustomEvent<PromptPublishRequest>(BUILD_PROMPT_PUBLISH_REQUEST, { cancelable: true, detail: { userId: 'builder', targetKey: entry.targetKey, prompt: null, loadError: true, resolve } }));
    expect(f.get('build-prompt-enter').disabled).toBe(true); f.get('build-prompt-enter').checked = true; f.get('build-prompt-publish-form').dispatchEvent(new Event('submit')); expect(resolve).toHaveBeenCalledExactlyOnceWith({ slug: null });
  });
  it('queues exact ordinary and expanded entries and labels a partial loaded page truthfully', async () => {
    const f = fixture(); f.repository.load.mockResolvedValue({ ...empty, prompt, current: prompt, entries: [entry, { ...entry, targetKey: 'expanded_room:course:level', contentType: 'expanded_room', contentId: 'course:level', version: 7, roomVersion: 3, legacyCourseId: 'level', cellCount: 2 }], nextOffset: 48 });
    const start = vi.fn(); f.win.addEventListener(ROOM_SEQUENCE_START_EVENT, start); f.get('btn-explore-build-prompt').click(); await tick(); expect(f.get('btn-build-prompt-play-all').textContent).toBe('Play Loaded (2)');
    f.get('btn-build-prompt-play-all').click(); const detail = (start.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.entries[0]).toMatchObject({ roomVersion: 3, buildPrompt: { slug: prompt.slug, targetKey: entry.targetKey, offset: 0 } });
    expect(detail.entries[1]).toMatchObject({ expandedRoomId: 'course:level', expandedRoomVersion: 7, roomVersion: 3, legacyCourseId: 'level' });
  });
  it('discards late public reads after close and hides entry retry after signing out', async () => {
    const f = fixture(); let resolve!: (value: BuildPromptsResponse) => void; f.repository.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    f.get('btn-explore-build-prompt').click(); f.controller.close(); resolve({ ...empty, prompt }); await tick(); expect(f.get('build-prompt-title').textContent).not.toBe(prompt.title);
    const retry = vi.fn(async () => {}); f.win.dispatchEvent(new CustomEvent(BUILD_PROMPT_ENTRY_RESULT, { detail: { userId: 'builder', slug: prompt.slug, title: 'Saved title', error: 'offline', retry } }));
    expect(f.get('build-prompt-result-status').textContent).toContain('was published'); f.get('btn-build-prompt-entry-retry').click(); await tick(); expect(retry).toHaveBeenCalledOnce();
    auth.user.id = 'other'; f.win.dispatchEvent(new Event('auth')); f.get('btn-build-prompt-entry-retry').click(); expect(retry).toHaveBeenCalledOnce(); expect(f.get('build-prompt-result').classList.contains('hidden')).toBe(true);
  });
});
