import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth', getAuthDebugState: () => ({ authenticated: false }), promptForSignIn: vi.fn() }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));
import type { PostRunRatingRequestDetail } from '../../progression/postRunRatingEvents';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT } from '../../progression/postRunRatingEvents';
import { REWARD_STINGS_IDLE_EVENT } from '../../progression/rewardStings';
import { RunRatingModalController } from './runRatingModal';

function fixture() {
  const elements = new Map<string, ReturnType<typeof element>>();
  function element() {
    const classes = new Set(['hidden']);
    return Object.assign(new EventTarget(), { textContent: '', disabled: false, dataset: {} as Record<string, string>, focus: vi.fn(), setAttribute: vi.fn(), replaceChildren: vi.fn(),
      classList: { contains: (name: string) => classes.has(name), add: (...names: string[]) => names.forEach(name => classes.add(name)),
        remove: (...names: string[]) => names.forEach(name => classes.delete(name)), toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name) } });
  }
  const quality = element(), difficulty = element(); quality.dataset.qualityStars = '4'; difficulty.dataset.progressionDifficulty = 'easy';
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appMode: 'play-world' } }, getElementById: (id: string) => {
    if (!elements.has(id)) elements.set(id, element()); return elements.get(id);
  }, querySelector: () => element(), querySelectorAll: (selector: string) => selector.includes('data-quality-stars') ? [quality]
    : selector.includes('data-progression-difficulty') ? [difficulty] : [] });
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const roomRepo = { loadRoomLeaderboard: vi.fn(), submitRoomRating: vi.fn() }, expandedRepo = { loadExpandedRoomLeaderboard: vi.fn(), submitExpandedRoomRating: vi.fn() };
  const controller = new RunRatingModalController({} as never, roomRepo as never, {} as never, expandedRepo as never, {} as never, doc as unknown as Document, win as unknown as Window);
  controller.init();
  const request = (detail: PostRunRatingRequestDetail) => win.dispatchEvent(new CustomEvent(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, { detail }));
  const stop = () => { doc.body.dataset.appMode = 'world'; win.dispatchEvent(new CustomEvent(REWARD_STINGS_IDLE_EVENT)); };
  return { controller, roomRepo, expandedRepo, elements, doc, request, stop, quality, difficulty };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const detail: PostRunRatingRequestDetail = { contentType: 'room', contentId: '0,0', roomCoordinates: { x: 0, y: 0 }, contentTitle: 'Test Room', version: 1,
  previousViewerRank: null, elapsedMs: 15557, deaths: 2, score: 10, autoSuggestedDifficulty: 'easy',
  guestProgress: { clientRunId: 'clear-1', attemptId: null, status: 'saved', durable: true, reason: null } };
const leaderboard = { roomId: '0,0', roomVersion: 1, rankingMode: 'time', entries: [{ elapsedMs: 3500, score: 100, userDisplayName: 'Fast Player' }] };
async function settle() { for (let i = 0; i < 4; i++) await Promise.resolve(); }
afterEach(() => vi.clearAllMocks());
describe('deferred guest result', () => {
  it.each(['room', 'expanded_room'])('keeps a new %s summary when an earlier save finishes loading after close', async kind => {
    const f = fixture(), late = deferred<typeof leaderboard & { viewerRank: number }>();
    const load = kind === 'room' ? f.roomRepo.loadRoomLeaderboard : f.expandedRepo.loadExpandedRoomLeaderboard;
    const save = kind === 'room' ? f.roomRepo.submitRoomRating : f.expandedRepo.submitExpandedRoomRating;
    const entry = { roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1,
      ...(kind === 'expanded_room' ? { expandedRoomId: 'old-expanded', expandedRoomVersion: 1 } : {}) };
    load.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(late.promise)
      .mockResolvedValue({ ...leaderboard, roomId: '1,0', expandedRoomId: 'new-expanded', expandedRoomVersion: 1, viewerRank: 2,
        entries: [{ elapsedMs: 1000, score: 100, userDisplayName: 'Current room' }] });
    save.mockResolvedValue({ progression: null, progressionDelta: { pxp: 0, bxp: 0, cxp: 0, trust: 0 } });
    await f.controller.openForSequence(entry);
    for (const button of [f.quality, f.difficulty, f.elements.get('btn-run-rating-submit')!]) button.dispatchEvent(new Event('click'));
    await settle(); expect(save).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledTimes(2);
    f.controller.close();
    await f.controller.openForSequence({ ...entry, roomId: '1,0', roomCoordinates: { x: 1, y: 0 },
      ...(kind === 'expanded_room' ? { expandedRoomId: 'new-expanded' } : {}) });
    expect(f.elements.get('run-rating-leaderboard')?.textContent).toContain('Leaderboard: #2');
    late.resolve({ ...leaderboard, viewerRank: 99 }); await settle(); f.quality.dispatchEvent(new Event('click'));
    expect(f.elements.get('run-rating-leaderboard')?.textContent).toContain('Leaderboard: #2');
    expect(f.elements.get('run-rating-modal')?.classList.contains('hidden')).toBe(false); f.controller.destroy();
  });
  it('recovers the exact room rating without inventing a new run or share card', async () => {
    const f = fixture(); f.roomRepo.loadRoomLeaderboard.mockRejectedValue(new Error('Offline'));
    await f.controller.openForSequence({ roomId: '0,0', roomCoordinates: { x:0,y:0 }, roomVersion: 7, roomTitle: 'Recovered room' });
    expect(f.roomRepo.loadRoomLeaderboard).toHaveBeenCalledWith('0,0',{x:0,y:0},7,5);
    for (const id of ['run-rating-result','run-rating-suggestion','run-rating-share']) expect(f.elements.get(id)?.classList.contains('hidden')).toBe(true);
    expect(f.elements.get('run-rating-result')?.textContent).toBe('');
    f.controller.close(); f.request(detail); f.stop(); await settle();
    expect(f.elements.get('run-rating-result')?.classList.contains('hidden')).toBe(false);
    expect(f.elements.get('run-rating-result')?.textContent).toBe('0:15.5 · 2 deaths · 10 pts'); f.controller.destroy();
  });
  it('recovers a native expanded rating using its own target and version', async () => {
    const f = fixture(); f.expandedRepo.loadExpandedRoomLeaderboard.mockRejectedValue(new Error('Offline'));
    await f.controller.openForSequence({ roomId:'0,0',roomCoordinates:{x:0,y:0},roomVersion:1,expandedRoomId:'native',expandedRoomVersion:3,legacyCourseId:'legacy' });
    expect(f.expandedRepo.loadExpandedRoomLeaderboard).toHaveBeenCalledWith('native',3,5);
    expect(f.roomRepo.loadRoomLeaderboard).not.toHaveBeenCalled();
    expect(f.elements.get('run-rating-result')?.classList.contains('hidden')).toBe(true); f.controller.destroy();
  });
  it('keeps playing uninterrupted, then shows room, time, deaths and the matching best', async () => {
    const f = fixture(); f.roomRepo.loadRoomLeaderboard.mockResolvedValue(leaderboard); f.request(detail);
    expect(f.elements.get('run-rating-modal')?.classList.contains('hidden')).toBe(true); expect(f.roomRepo.loadRoomLeaderboard).not.toHaveBeenCalled();
    f.stop(); await settle();
    expect(f.elements.get('run-rating-meta')?.textContent).toBe('Test Room');
    expect(f.elements.get('run-rating-result')?.classList.contains('hidden')).toBe(false);
    expect(f.elements.get('run-rating-result')?.textContent).toBe('0:15.5 · 2 deaths · 10 pts');
    expect(f.elements.get('run-rating-leaderboard')?.textContent).toBe('Best: Fast Player · 0:03.5 · 0:12.0 behind');
    expect(f.elements.get('run-guest-claim-copy')?.textContent).toContain('within 14 days'); f.controller.destroy();
  });
  it('does not reopen a closed prompt or adopt a different version from a delayed reply', async () => {
    const f = fixture(); const old = deferred<typeof leaderboard>(); f.roomRepo.loadRoomLeaderboard.mockReturnValueOnce(old.promise);
    f.request(detail); f.stop(); f.controller.close(); old.resolve(leaderboard); await settle();
    expect(f.elements.get('run-rating-modal')?.classList.contains('hidden')).toBe(true);
    f.roomRepo.loadRoomLeaderboard.mockResolvedValue({ ...leaderboard, roomVersion: 1 });
    f.request({ ...detail, version: 2, elapsedMs: 2000 }); await settle();
    expect(f.elements.get('run-rating-result')?.textContent).toContain('0:02.0');
    expect(f.elements.get('run-rating-leaderboard')?.textContent).toBe('Best run unavailable.'); f.controller.destroy();
  });
  it('uses the expanded target/version while accepting a legacy course identity, and preserves the claim when offline', async () => {
    const f = fixture(); f.expandedRepo.loadExpandedRoomLeaderboard.mockResolvedValue({ ...leaderboard, roomId: undefined,
      expandedRoomId: 'course:test', expandedRoomVersion: 2, courseId: 'test', courseVersion: 2 });
    f.request({ ...detail, contentType: 'expanded_room', contentId: 'course:test', expandedRoomId: 'course:test', version: 2 }); f.stop(); await settle();
    expect(f.elements.get('run-rating-leaderboard')?.textContent).toContain('Best: Fast Player'); f.controller.close();
    f.roomRepo.loadRoomLeaderboard.mockRejectedValue(new TypeError('Offline')); f.request(detail); await settle();
    expect(f.elements.get('run-rating-leaderboard')?.textContent).toBe('Best run unavailable.');
    expect(f.elements.get('btn-run-guest-claim-signin')?.textContent).toBe('Save Progress'); f.controller.destroy();
  });
});
