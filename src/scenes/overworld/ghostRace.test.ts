import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { GoalRunState } from './goalRuns';
import type { RunGhost } from '../../runs/ghostRace';
vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { NEAREST: 0 } } } }));
vi.mock('../../player/avatar/dynamic', () => ({ ensureSceneAvatarPackLoaded: async () => ({
  idleTextureKey: 'idle', idleFrame: '0', animationKeys: { idle: 'idle', run: 'run', 'jump-rise': 'rise', 'jump-fall': 'fall' },
}) }));
import { OverworldGhostRaceController } from './ghostRace';
const ghost: RunGhost = { schemaVersion: 1, attemptId: 'top', roomId: '1,2', roomVersion: 1, displayName: 'Leader',
  avatarId: 'default-player', elapsedMs: 1000, points: [
    { atMs: 0, roomX: 1, roomY: 2, x: 0, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
    { atMs: 1000, roomX: 1, roomY: 2, x: 100, y: 100, vx: 100, vy: 0, grounded: true, snap: false },
  ] };
function fixture() {
  let user: string | null = null, mode = 'play';
  const object = () => {
    const o = { visible: false, body: null, anims: { currentAnim: null as { key: string } | null },
      texture: { setFilter: vi.fn() }, setPosition: vi.fn(), setFlipX: vi.fn(), destroy: vi.fn(),
      play: (key: string) => { o.anims.currentAnim = { key }; },
      setVisible: (visible: boolean) => { o.visible = visible; return o; },
      setOrigin: () => o, setAlpha: () => o, setTint: () => o, setDepth: () => o };
    return o;
  };
  const sprite = object(), label = object(), physics = { add: { sprite: vi.fn() } };
  const scene = { add: { sprite: vi.fn(() => sprite), text: vi.fn(() => label) }, physics } as unknown as Phaser.Scene;
  const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 }); room.version = 2;
  room.goal = { type: 'reach_exit', exit: { x: 100, y: 100 }, timeLimitMs: null };
  const run = { roomId: '1,2', roomCoordinates: { x: 1, y: 2 }, roomVersion: 2, goal: room.goal,
    qualificationState: 'qualified', elapsedMs: 0, deaths: 0 } as GoalRunState;
  const status = vi.fn();
  const controller = new OverworldGhostRaceController({ scene, getRun: () => run, getMode: () => mode,
    getUserId: () => user, getRoomOrigin: () => ({ x: 640, y: 704 }), onDisplayObjectsChanged: vi.fn(), showStatus: status });
  return { controller, sprite, physics, run, room, status, setUser: (value: string | null) => { user = value; }, stop: () => { mode = 'browse'; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('independent race presentation', () => {
  it('shares the run timer through death and restart, while accepting a matching equivalent-version ghost', async () => {
    const f = fixture(); f.controller.select(ghost, 'top', f.room); await Promise.resolve(); f.controller.update();
    expect(f.controller.getDebugSnapshot()).toMatchObject({ choice: 'top', visible: true, hasPhysicsBody: false });
    f.run.elapsedMs = 500; f.run.deaths++; f.controller.update();
    expect(f.controller.getDebugSnapshot().position?.x).toBe(690);
    f.run.elapsedMs = 0; f.controller.update();
    expect(f.controller.getDebugSnapshot().position?.x).toBe(640);
    expect(f.physics.add.sprite).not.toHaveBeenCalled();
  });
  it('clears on Stop or account changes, and cancels pending avatar creation', async () => {
    const f = fixture(); f.controller.select(ghost, 'top', f.room); f.controller.clear(); await Promise.resolve();
    expect(f.sprite.setPosition).not.toHaveBeenCalled();
    f.controller.select(ghost, 'personal', f.room); await Promise.resolve(); f.setUser('different'); f.controller.update();
    expect(f.controller.getDebugSnapshot().choice).toBe('off');
    f.controller.select(ghost, 'top', f.room); await Promise.resolve(); f.stop(); f.controller.update();
    expect(f.controller.getDebugSnapshot().visible).toBe(false);
  });
  it('uses the newly verified guest best on the next Restart', async () => {
    const f = fixture(), best = { ...ghost, attemptId: 'new-best', roomVersion: 2, elapsedMs: 800 };
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify([{ ghost: best, deaths: 0 }]) } });
    f.controller.select(ghost, 'personal', f.room); await Promise.resolve();
    await f.controller.refreshAfterRestart(); await Promise.resolve();
    expect(f.controller.getDebugSnapshot()).toMatchObject({ attemptId: 'new-best', elapsedMs: 800 });
  });
  it('reloads account bests without stale cache and ignores a response after Stop', async () => {
    const f = fixture(); f.setUser('viewer');
    const best = { ...ghost, attemptId: 'account-new-best', roomVersion: 2, elapsedMs: 750 };
    const fetch = vi.fn(async () => Response.json({ roomId: '1,2', roomVersion: 2, personal: { ghost: best } }));
    vi.stubGlobal('fetch', fetch);
    f.controller.select(ghost, 'personal', f.room); await Promise.resolve();
    await f.controller.refreshAfterRestart();
    expect(f.controller.getDebugSnapshot().attemptId).toBe('account-new-best');
    expect(fetch.mock.calls[0]).toMatchObject([expect.any(String), { cache: 'no-store', credentials: 'include' }]);
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    const pending = f.controller.refreshAfterRestart(); f.stop(); f.controller.clear();
    resolve(Response.json({ roomId: '1,2', roomVersion: 2, personal: { ghost: best } })); await pending;
    expect(f.controller.getDebugSnapshot().choice).toBe('off');
  });
  it('explains refresh failures and clears a recording that becomes unavailable', async () => {
    const f = fixture(); f.setUser('viewer');
    f.controller.select(ghost, 'top', f.room); await Promise.resolve();
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('offline'); }));
    await f.controller.refreshAfterRestart();
    expect(f.controller.getDebugSnapshot().attemptId).toBe('top');
    expect(f.status).toHaveBeenCalledWith('Ghost could not refresh. Racing the previous recording.');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ roomId: '1,2', roomVersion: 2, top: { ghost: null } })));
    await f.controller.refreshAfterRestart();
    expect(f.controller.getDebugSnapshot().choice).toBe('off');
    expect(f.status).toHaveBeenCalledWith('Ghost recording unavailable. Playing on your own.');
  });
});
