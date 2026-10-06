import { describe, expect, it, vi } from 'vitest';
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
  const run = { roomId: '1,2', roomVersion: 2, qualificationState: 'qualified', elapsedMs: 0, deaths: 0 } as GoalRunState;
  const controller = new OverworldGhostRaceController({ scene, getRun: () => run, getMode: () => mode,
    getUserId: () => user, getRoomOrigin: () => ({ x: 640, y: 704 }), onDisplayObjectsChanged: vi.fn() });
  return { controller, sprite, physics, run, room, setUser: (value: string | null) => { user = value; }, stop: () => { mode = 'browse'; } };
}
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
});
