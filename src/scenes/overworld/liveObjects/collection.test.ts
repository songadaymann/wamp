import { describe, expect, it, vi } from 'vitest';
import { collectLiveObject } from './collection';

function fixture(objectId = 'coin') {
  let alive = false;
  let collected = false;
  const object = { key: 'coin', placedInstanceId: 'coin', countsTowardGoals: true,
    config: { id: objectId, name: 'Pickup' }, sprite: { active: true, x: 64, y: 128, destroy: vi.fn() } };
  const room = { room: { id: '0,0', coordinates: { x: 0, y: 0 } }, liveObjects: [object] };
  const host = { canPlayerCollect: () => alive, scene: { tweens: { add: vi.fn() } },
    isCollectedObjectKey: () => collected, markCollectedObjectKey: vi.fn(() => { collected = true; }), addScore: vi.fn(),
    onHealingCollected: vi.fn(() => true),
    onKeyCollected: vi.fn(), playCollectFx: vi.fn(), playRoomSfx: vi.fn(), showTransientStatus: vi.fn(),
    getRoomOrigin: () => ({ x: 0, y: 0 }), onCollectibleCollected: vi.fn(), onEnemyCollectibleCollected: vi.fn(),
    onLiveObjectRemoved: vi.fn(), destroyLiveObjectInteractions: vi.fn() };
  const collect = (collector: 'player' | 'enemy' = 'player') => collectLiveObject(
    room as unknown as Parameters<typeof collectLiveObject>[0],
    object as unknown as Parameters<typeof collectLiveObject>[1],
    host as unknown as Parameters<typeof collectLiveObject>[2], { collector });
  return { host, room, collect, revive: () => { alive = true; } };
}

describe('collections during a death beat', () => {
  it('ignores a later same-frame player overlap without consuming the coin or granting credit', () => {
    const f = fixture(); f.collect();
    expect(f.room.liveObjects).toHaveLength(1);
    expect(f.host.markCollectedObjectKey).not.toHaveBeenCalled();
    expect(f.host.addScore).not.toHaveBeenCalled();
    expect(f.host.onCollectibleCollected).not.toHaveBeenCalled();
    f.revive(); f.collect();
    expect(f.room.liveObjects).toHaveLength(0);
    expect(f.host.onCollectibleCollected).toHaveBeenCalledTimes(1);
  });

  it('retains enemy collectors independently of the dead player', () => {
    const f = fixture(); f.collect('enemy');
    expect(f.room.liveObjects).toHaveLength(0);
    expect(f.host.onEnemyCollectibleCollected).toHaveBeenCalledTimes(1);
    expect(f.host.addScore).not.toHaveBeenCalled();
  });

  it.each(['heart', 'boygame_heart', 'health_potion'])('heals once for %s while retaining collectible score and goal credit', id => {
    const f = fixture(id); f.revive(); f.collect(); f.collect();
    expect(f.host.onHealingCollected).toHaveBeenCalledTimes(1);
    expect(f.host.addScore).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.host.onCollectibleCollected).toHaveBeenCalledTimes(1);
    expect(f.host.showTransientStatus).toHaveBeenCalledWith('Pickup restored a heart.');
  });

  it('an enemy taking a heart never heals the player', () => {
    const f = fixture('heart'); f.collect('enemy');
    expect(f.host.onHealingCollected).not.toHaveBeenCalled();
    expect(f.host.onEnemyCollectibleCollected).toHaveBeenCalledTimes(1);
  });

  it('routes Lost Song to personal progress without goal, score, shared removal or destruction; enemies cannot take it', () => {
    const f = fixture('lost_song'); f.revive();
    const onLostSongCollected = vi.fn();
    Object.assign(f.host, { onLostSongCollected });
    f.collect('enemy');
    expect(onLostSongCollected).not.toHaveBeenCalled();
    f.collect();
    expect(onLostSongCollected).toHaveBeenCalledExactlyOnceWith('0,0');
    expect(f.room.liveObjects).toHaveLength(1);
    expect(f.host.addScore).not.toHaveBeenCalled();
    expect(f.host.markCollectedObjectKey).not.toHaveBeenCalled();
    expect(f.host.onCollectibleCollected).not.toHaveBeenCalled();
    expect(f.host.onLiveObjectRemoved).not.toHaveBeenCalled();
    expect(f.host.scene.tweens.add).not.toHaveBeenCalled();
  });
});
