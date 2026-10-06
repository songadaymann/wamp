import { describe, expect, it, vi } from 'vitest';
import { collectLiveObject } from './collection';

function fixture() {
  let alive = false;
  const object = { key: 'coin', placedInstanceId: 'coin', countsTowardGoals: true,
    config: { id: 'coin', name: 'Coin' }, sprite: { active: true, x: 64, y: 128, destroy: vi.fn() } };
  const room = { room: { id: '0,0', coordinates: { x: 0, y: 0 } }, liveObjects: [object] };
  const host = { canPlayerCollect: () => alive, scene: { tweens: { add: vi.fn() } },
    isCollectedObjectKey: () => false, markCollectedObjectKey: vi.fn(), addScore: vi.fn(),
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
});
