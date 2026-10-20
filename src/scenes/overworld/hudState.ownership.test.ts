import { afterEach, describe, expect, it, vi } from 'vitest';
const { auth, world } = vi.hoisted(() => ({ auth: { authenticated: true, user: { id: 'buyer', walletAddress: '0xbuyer' } }, world: { id: null as string | null } }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => auth }));
vi.mock('../../worlds/clientContext', () => ({ getActiveWorldId: () => world.id, canBuildInActiveWorld: () => false }));
import { OverworldHudStateController } from './hudState';
import type { SelectedRoomOwnershipViewData } from './hudViewModel';
const detail = (owner: string): SelectedRoomOwnershipViewData => ({ claimerUserId: 'builder', isMinted: true, mintedOwnerWalletAddress: owner });
function harness() {
  const selected = { x: 0, y: 0 }, activity = { active: true };
  const load = vi.fn<() => Promise<SelectedRoomOwnershipViewData>>(async () => detail('seller'));
  const host: ConstructorParameters<typeof OverworldHudStateController>[0] = {
    getMode: () => 'browse', getSelectedCoordinates: () => selected,
    isActive: () => activity.active, loadRoomOwnershipDetails: load,
    getCellStateAt: () => 'published', getRoomSummary: () => undefined, getDraftRoom: () => null,
    getRoomPopulation: () => 0, getRoomEditorCount: () => 0, getRoomEditorDisplayNames: () => [],
    getActiveCourseRun: () => null, getActiveRoomRushRun: () => null, getCurrentGoalRun: () => null,
    getRoomSnapshotForCoordinates: () => null, getCurrentRoomLeaderboard: () => null,
    getGoalPersistentStatusText: () => null, getTotalPlayerCount: () => 0, getOnlineRosterEntries: () => [],
    getActiveSignState: () => null, loadPublicProfileSummary: async () => null,
    loadPublishedCourseSnapshot: async () => null, countRoomEnemies: () => 0, getScore: () => 0,
    areRoomCommentsVisible: () => false, getZoom: () => 1, getTransientStatusMessage: () => null,
    renderHudViewModel: () => {}, syncOverlayScale: () => {},
  };
  const controller = new OverworldHudStateController(host);
  vi.spyOn(controller, 'renderHud').mockImplementation(() => {}); controller.captureOwnershipEditContext();
  return { controller, selected, activity, load };
}
afterEach(() => { auth.authenticated = true; auth.user = { id: 'buyer', walletAddress: '0xbuyer' }; world.id = null; });
describe('HUD ownership cache and editor context', () => {
  it('does not let an older summary overwrite a verified refresh', async () => {
    const f = harness(); let resolve!: (v: SelectedRoomOwnershipViewData) => void;
    f.load.mockImplementation(() => new Promise(r => { resolve = r; }));
    f.controller['ensureSelectedOwnershipLoaded']('0,0', { x: 0, y: 0 }, 'published');
    f.controller.setRoomOwnershipDetails('0,0', detail('buyer')); resolve(detail('seller')); await Promise.resolve();
    expect(f.controller['selectedOwnershipByRoomId'].get('0,0')).toEqual(detail('buyer'));
  });
  it('does not repopulate a reset cache from an old in-flight request', async () => {
    const f = harness(); let resolve!: (v: SelectedRoomOwnershipViewData) => void;
    f.load.mockImplementation(() => new Promise(r => { resolve = r; }));
    f.controller['ensureSelectedOwnershipLoaded']('0,0', { x: 0, y: 0 }, 'published');
    f.controller.reset(); resolve(detail('seller')); await Promise.resolve();
    expect(f.controller['selectedOwnershipByRoomId'].size).toBe(0);
  });
  it.each(['selection', 'wallet', 'session', 'world', 'reset', 'sleep'] as const)('invalidates an edit context after %s', async kind => {
    const f = harness(), current = f.controller.captureOwnershipEditContext();
    if (kind === 'selection') f.selected.x = 1;
    if (kind === 'wallet') auth.user.walletAddress = '0xother';
    if (kind === 'session') auth.authenticated = false;
    if (kind === 'world') world.id = 'other';
    if (kind === 'reset') f.controller.reset();
    if (kind === 'sleep') f.activity.active = false;
    expect(current()).toBe(false);
  });
  it('retains invalidation after navigating away and back, and notifies pending checks', () => {
    const f = harness(), current = f.controller.captureOwnershipEditContext(), invalidate = vi.fn();
    const stop = f.controller.onOwnershipEditInvalidation(invalidate);
    f.selected.x = 1; f.controller.captureOwnershipEditContext(); f.selected.x = 0;
    expect(current()).toBe(false); expect(invalidate).toHaveBeenCalled(); stop();
    invalidate.mockClear(); f.controller.reset(); expect(invalidate).not.toHaveBeenCalled();
  });
});
