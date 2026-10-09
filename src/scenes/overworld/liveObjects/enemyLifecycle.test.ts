import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Geom: {
  Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} },
  Intersects: { RectangleToRectangle: (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y },
} } }));
import { LiveObjectEnemyLifecycleController } from './enemyLifecycle';
import type { LoadedRoomObject } from './model';
import type { LoadedFullRoom } from '../worldStreaming';
import { createBossHealthState } from '../../../enemies/boss';

function object(key: string, x = 20, npc = false, invincible = false): LoadedRoomObject {
  const sprite = { x: x + 6, y: 36, active: true, body: { left: x, top: 26, width: 12, height: 10, enable: true }, destroy: vi.fn() };
  sprite.destroy.mockImplementation(() => { sprite.active = false; });
  return { key, placedInstanceId: key, countsTowardGoals: true, sprite,
    config: { id: npc ? 'npc_jimothy' : 'slime_blue', name: npc ? 'Jimothy' : 'Blue Slime', category: npc ? 'npc' : 'enemy' },
    runtime: { npcFriendlyFire: true, npcDefeatMode: invincible ? 'invincible' : 'defeatable', cooldownUntil: 0 },
  } as unknown as LoadedRoomObject;
}
function room(id: string, liveObjects: LoadedRoomObject[], x = 0): LoadedFullRoom<LoadedRoomObject> {
  return { room: { id, coordinates: { x, y: 0 } }, liveObjects } as LoadedFullRoom<LoadedRoomObject>;
}
function harness() {
  const scene = { time: { now: 1000 }, anims: { exists: () => false } };
  const callbacks = {
    scene, settings: { enemyStompBounceVelocity: -245 }, getLoadedFullRooms: () => [],
    getRoomOrigin: (coordinates: { x: number; y: number }) => ({ x: coordinates.x * 640, y: coordinates.y * 352 }),
    getPlayer: () => null, getPlayerBody: () => null, addScore: vi.fn(), playEnemyKillFx: vi.fn(),
    playBounceFx: vi.fn(), showTransientStatus: vi.fn(), handlePlayerDeath: vi.fn(),
    onEnemyDefeated: vi.fn(() => false), onNpcDefeated: vi.fn(), onLiveObjectRemoved: vi.fn(),
    getSwordsmanObjectiveMode: () => 'duel', getSwordsmanDefeatMode: () => 'defeatable',
    swordsmanSwordCanDamagePlayer: () => false, createLiveObjectEntry: () => null,
    destroyLiveObjectInteractions: vi.fn(), destroyLiveObjectWorldColliders: vi.fn(),
    destroyLiveObjectHelpers: vi.fn(), syncWorldObjectColliders: vi.fn(), syncLiveObjectInteractions: vi.fn(),
  };
  return { controller: new LiveObjectEnemyLifecycleController(callbacks as never), callbacks, scene };
}
const rect = { x: 0, y: 0, width: 800, height: 100 } as never;

describe('per-swing enemy contacts', () => {
  it('keeps police contact dangerous while the boss is protected from another hit', () => {
    const h = harness(), boss = object('boss'), loaded = room('0,0', [boss]);
    boss.config = { ...boss.config, id: 'police_patrolman' };
    boss.runtime.boss = createBossHealthState(3);
    boss.runtime.boss!.protectedUntil = 1600;
    vi.spyOn(h.callbacks, 'getPlayer').mockReturnValue({} as never);
    vi.spyOn(h.callbacks, 'getPlayerBody').mockReturnValue({ velocity: { y: 0 }, bottom: 40 } as never);
    h.controller.handleEnemyContact(loaded, boss);
    expect(h.callbacks.handlePlayerDeath).toHaveBeenCalledTimes(1);
    expect(boss.runtime.boss?.health).toBe(3);
    expect(h.callbacks.addScore).not.toHaveBeenCalled();
  });
  it('damages bosses once per swing and awards goals, removal and points only on the final separate hit', () => {
    const h = harness(), boss = object('boss'), loaded = room('0,0', [boss]), keys = new Set<string>();
    boss.runtime.boss = createBossHealthState(3);
    boss.runtime.directionX = 1;
    boss.sprite.body = { ...boss.sprite.body, center: { x: 26, y: 36 }, velocity: { x: 0, y: 0 },
      setAllowGravity: vi.fn(), setVelocity: vi.fn() } as never;
    expect(h.controller.attackEnemiesInRect([loaded], rect, 1, keys)).toHaveLength(1);
    expect(boss.runtime.boss?.health).toBe(2);
    expect(h.controller.attackEnemiesInRect([loaded], rect, 1, keys)).toEqual([]);
    h.scene.time.now = 1599;
    expect(h.controller.attackEnemyAtPoint([loaded], 26, 30)).toBeNull();
    expect(h.callbacks.addScore).not.toHaveBeenCalled();
    expect(h.callbacks.onEnemyDefeated).not.toHaveBeenCalled();
    expect(h.callbacks.onLiveObjectRemoved).not.toHaveBeenCalled();
    expect(loaded.liveObjects).toEqual([boss]);
    h.scene.time.now = 1600;
    expect(h.controller.attackEnemyAtPoint([loaded], 26, 30)).not.toBeNull();
    expect(boss.runtime.boss?.health).toBe(1);
    h.scene.time.now = 2200;
    expect(h.controller.attackEnemyAtPoint([loaded], 26, 30)).not.toBeNull();
    expect(loaded.liveObjects).toEqual([]);
    expect(h.callbacks.addScore).toHaveBeenCalledExactlyOnceWith(10);
    expect(h.callbacks.onEnemyDefeated).toHaveBeenCalledTimes(1);
    expect(h.callbacks.onLiveObjectRemoved).toHaveBeenCalledTimes(1);
  });
  it('records an invincible contact once even after the toast cooldown, and permits a later swing', () => {
    const h = harness(), npc = object('invincible', 20, true, true), loaded = room('0,0', [npc]), keys = new Set<string>();
    expect(h.controller.attackEnemiesInRect([loaded], rect, 3, keys)).toEqual([]);
    expect(keys.size).toBe(1); expect(npc.sprite.active).toBe(true);
    h.scene.time.now = 2000;
    expect(h.controller.attackEnemiesInRect([loaded], rect, 3, keys)).toEqual([]);
    expect(h.callbacks.showTransientStatus).toHaveBeenCalledExactlyOnceWith("Jimothy can't be defeated.");
    expect(h.controller.attackEnemiesInRect([loaded], rect, 3, new Set())).toEqual([]);
    expect(h.callbacks.showTransientStatus).toHaveBeenCalledTimes(2);
    expect(h.callbacks.addScore).not.toHaveBeenCalled();
  });

  it('keeps identical object keys in different rooms independent and records real defeat callbacks', () => {
    const h = harness(), first = room('0,0', [object('same', 20)]), second = room('1,0', [object('same', 660)], 1), keys = new Set<string>();
    const hits = h.controller.attackEnemiesInRect([first, second], rect, 3, keys);
    expect(hits.map(h => h.roomId)).toEqual(['0,0', '1,0']); expect(keys.size).toBe(2);
    expect(first.liveObjects).toEqual([]); expect(second.liveObjects).toEqual([]);
    expect(h.callbacks.addScore.mock.calls).toEqual([[10], [10]]);
    expect(h.callbacks.onEnemyDefeated).toHaveBeenCalledTimes(2);
    expect(h.callbacks.onLiveObjectRemoved.mock.calls[1][0]).toMatchObject({ roomId: '1,0', instanceId: 'same', reason: 'enemy-defeated', x: 26, y: 36 });
  });

  it('does not attempt a respawned object with the same identity twice within one contact set', () => {
    const h = harness(), loaded = room('0,0', [object('respawn')]), keys = new Set<string>();
    expect(h.controller.attackEnemiesInRect([loaded], rect, 3, keys)).toHaveLength(1);
    const replacement = object('respawn'); loaded.liveObjects.push(replacement);
    expect(h.controller.attackEnemiesInRect([loaded], rect, 2, keys)).toEqual([]);
    expect(replacement.sprite.active).toBe(true); expect(h.callbacks.addScore).toHaveBeenCalledTimes(1);
  });

  it('honors the hit budget and does not defeat an extra enemy when the remaining budget is zero', () => {
    const h = harness(), loaded = room('0,0', Array.from({ length: 4 }, (_, i) => object('slime-' + i))), keys = new Set<string>();
    expect(h.controller.attackEnemiesInRect([loaded], rect, 3, keys)).toHaveLength(3);
    expect(h.controller.attackEnemiesInRect([loaded], rect, 0, keys)).toEqual([]);
    expect(loaded.liveObjects).toHaveLength(1); expect(loaded.liveObjects[0].sprite.active).toBe(true);
    expect(keys.size).toBe(3); expect(h.callbacks.addScore).toHaveBeenCalledTimes(3);
  });

  it('leaves friendly NPCs out of the contact set and defeat flow', () => {
    const h = harness(), npc = object('friendly', 20, true), loaded = room('0,0', [npc]), keys = new Set<string>();
    npc.runtime.npcFriendlyFire = false;
    expect(h.controller.attackEnemiesInRect([loaded], rect, 3, keys)).toEqual([]);
    expect(keys.size).toBe(0); expect(h.callbacks.onNpcDefeated).not.toHaveBeenCalled();
  });
});
