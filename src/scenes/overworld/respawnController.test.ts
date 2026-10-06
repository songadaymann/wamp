import { describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RespawnCheckpoint } from '../../goals/respawnCheckpoints';
import { OverworldRespawnController } from './respawnController';

function harness() {
  const room = createDefaultRoomSnapshot();
  let checkpoint: RespawnCheckpoint | null = { kind: 'object', instanceId: 'flag', checkpointIndex: null,
    roomId: '2,0', roomCoordinates: { x: 2, y: 0 }, x: 320, y: 256 };
  let courseStart: { roomId: string; coordinates: { x: number; y: number }; roomVersion: number; roomTitle: null } | null = null;
  const host = { getCheckpoint: () => checkpoint, getCourseStartRoom: () => courseStart,
    getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }), getRoomSnapshot: vi.fn(() => room),
    getPlayerEntities: vi.fn(() => ({})), clearTransientPlayerState: vi.fn(), focusRoom: vi.fn(),
    respawnPlayerToRoom: vi.fn(), presentRespawn: vi.fn(), recordRespawn: vi.fn(), refreshAroundFromCache: vi.fn(),
    destroyPlayer: vi.fn(), requestPlayerCreation: vi.fn(), refreshAround: vi.fn().mockResolvedValue(true), playRespawnSound: vi.fn() };
  const controller = new OverworldRespawnController(host as unknown as ConstructorParameters<typeof OverworldRespawnController>[0]);
  return { host, controller, room, setCheckpoint: (next: typeof checkpoint) => { checkpoint = next; },
    setCourseStart: (next: typeof courseStart) => { courseStart = next; } };
}
describe('checkpoint respawn orchestration', () => {
  it('focuses the touched room before resetting an existing body and records its reference afterward', () => {
    const h = harness(); h.controller.respawnPlayer();
    expect(h.host.focusRoom).toHaveBeenCalledWith({ x: 2, y: 0 });
    expect(h.host.getRoomSnapshot).toHaveBeenCalledWith({ x: 2, y: 0 });
    expect(h.host.recordRespawn).toHaveBeenCalledWith({ kind: 'object', instanceId: 'flag', checkpointIndex: null });
    expect(h.host.focusRoom.mock.invocationCallOrder[0]).toBeLessThan(h.host.respawnPlayerToRoom.mock.invocationCallOrder[0]);
    expect(h.host.respawnPlayerToRoom.mock.invocationCallOrder[0]).toBeLessThan(h.host.recordRespawn.mock.invocationCallOrder[0]);
    expect(h.host.refreshAroundFromCache).toHaveBeenCalledWith({ x: 2, y: 0 });
    expect(h.host.destroyPlayer).not.toHaveBeenCalled();
  });
  it('falls back to the locked course start before the current room', () => {
    const h = harness(); h.setCheckpoint(null);
    h.setCourseStart({ roomId: '-3,1', coordinates: { x: -3, y: 1 }, roomVersion: 1, roomTitle: null });
    h.controller.respawnPlayer(); expect(h.host.focusRoom).toHaveBeenCalledWith({ x: -3, y: 1 });
    expect(h.host.recordRespawn).toHaveBeenCalledWith({ kind: 'start', instanceId: null, checkpointIndex: null });
  });
  it('keeps an ordinary untouched respawn in the current room without changing focus', () => {
    const h = harness(); h.setCheckpoint(null); h.controller.respawnPlayer();
    expect(h.host.getRoomSnapshot).toHaveBeenCalledWith({ x: 0, y: 0 });
    expect(h.host.focusRoom).not.toHaveBeenCalled(); expect(h.host.refreshAroundFromCache).not.toHaveBeenCalled();
  });
  it('waits for the recreated player before recording an unloaded checkpoint reset, exactly once', () => {
    const h = harness(); h.host.getRoomSnapshot.mockReturnValue(null as never); h.controller.respawnPlayer();
    expect(h.host.destroyPlayer).toHaveBeenCalledTimes(1); expect(h.host.requestPlayerCreation).toHaveBeenCalledTimes(1);
    expect(h.host.refreshAround).toHaveBeenCalledWith({ x: 2, y: 0 }); expect(h.host.recordRespawn).not.toHaveBeenCalled();
    h.controller.handlePlayerCreated(); h.controller.handlePlayerCreated(); expect(h.host.recordRespawn).toHaveBeenCalledTimes(1);
  });
  it('drops an unfinished respawn reference on a fresh session', () => {
    const h = harness(); h.host.getRoomSnapshot.mockReturnValue(null as never); h.controller.respawnPlayer();
    h.controller.reset(); h.controller.handlePlayerCreated(); expect(h.host.recordRespawn).not.toHaveBeenCalled();
  });
});
