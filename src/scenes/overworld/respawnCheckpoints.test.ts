import { describe, expect, it, vi } from 'vitest';
import type { RespawnCheckpoint } from '../../goals/respawnCheckpoints';
import { OverworldRespawnCheckpointController, type RespawnCheckpointScope } from './respawnCheckpoints';

function checkpoint(instanceId = 'first', roomId = '0,0'): RespawnCheckpoint {
  return { kind: 'object', roomId, roomCoordinates: { x: 0, y: 0 }, x: 96, y: 240,
    instanceId, checkpointIndex: null };
}
function harness() {
  let scope: RespawnCheckpointScope | null = { owner: {}, roomIds: ['0,0', '0,1'] };
  const onActivated = vi.fn(); const onChanged = vi.fn();
  const controller = new OverworldRespawnCheckpointController({ getScope: () => scope, onActivated, onChanged });
  return { controller, onActivated, onChanged, setScope: (next: RespawnCheckpointScope | null) => { scope = next; } };
}

describe('touched respawn checkpoints', () => {
  it('starts empty, keeps the latest newly touched flag and does not reactivate earlier flags', () => {
    const h = harness();
    expect(h.controller.getCheckpoint()).toBeNull();
    expect(h.controller.activate(checkpoint())).toBe(true);
    expect(h.controller.activate(checkpoint())).toBe(false);
    const next = { ...checkpoint('second', '0,1'), roomCoordinates: { x: 0, y: 1 } };
    expect(h.controller.activate(next)).toBe(true);
    expect(h.controller.activate(checkpoint())).toBe(false);
    expect(h.controller.getCheckpoint()).toEqual(next);
    expect(h.controller.isObjectReached('0,0', 'first')).toBe(true);
    expect(h.controller.isObjectReached('0,1', 'second')).toBe(true);
    expect(h.onActivated).toHaveBeenCalledTimes(2);
  });

  it('shares the latest respawn between placed flags and ordered Sprint markers', () => {
    const h = harness(); h.controller.activate(checkpoint());
    const goal: RespawnCheckpoint = { ...checkpoint(), kind: 'goal', instanceId: null, checkpointIndex: 0 };
    expect(h.controller.activate(goal)).toBe(true);
    expect(h.controller.getCheckpoint()).toEqual(goal);
    expect(h.controller.activate(goal)).toBe(false);
    h.controller.activate(checkpoint('later'));
    expect(h.controller.getCheckpoint()?.instanceId).toBe('later');
  });

  it('clears touched flags for a new run even when the footprint is unchanged', () => {
    const h = harness(); h.controller.activate(checkpoint());
    h.setScope({ owner: {}, roomIds: ['0,0', '0,1'] });
    expect(h.controller.getCheckpoint()).toBeNull();
    expect(h.controller.isObjectReached('0,0', 'first')).toBe(false);
    expect(h.controller.activate(checkpoint())).toBe(true);
  });

  it('clears on restart and permits the same flag in the fresh session', () => {
    const h = harness(); h.controller.activate(checkpoint()); h.controller.clear();
    expect(h.controller.getCheckpoint()).toBeNull();
    expect(h.controller.activate(checkpoint())).toBe(true);
  });

  it('clears practice touches when the same run object qualifies at its original start', () => {
    const h = harness(); const owner = {};
    h.setScope({ owner, phase: 'practice', roomIds: ['0,0'] });
    h.controller.activate(checkpoint());
    h.setScope({ owner, phase: 'qualified', roomIds: ['0,0'] });
    expect(h.controller.getCheckpoint()).toBeNull();
    expect(h.controller.isObjectReached('0,0', 'first')).toBe(false);
    expect(h.controller.activate(checkpoint())).toBe(true);
  });

  it('clears free exploration checkpoints when the current room changes', () => {
    const h = harness(); h.setScope({ owner: 'room:0,0', roomIds: ['0,0'] });
    h.controller.activate(checkpoint());
    h.setScope({ owner: 'room:0,1', roomIds: ['0,1'] });
    expect(h.controller.getCheckpoint()).toBeNull();
    expect(h.controller.activate(checkpoint())).toBe(false);
  });

  it('rejects flags outside the level or while no checkpoint scope is allowed', () => {
    const h = harness();
    expect(h.controller.activate(checkpoint('foreign', '2,2'))).toBe(false);
    h.controller.activate(checkpoint()); h.setScope(null);
    expect(h.controller.getCheckpoint()).toBeNull();
    expect(h.controller.activate(checkpoint())).toBe(false);
  });

  it.each([{ x: NaN }, { y: Infinity }, { x: -1 }, { y: 10000 },
    { instanceId: null }, { checkpointIndex: 1 }])('rejects invalid coordinates or reference %j', invalid => {
    const h = harness(); expect(h.controller.activate({ ...checkpoint(), ...invalid })).toBe(false);
    expect(h.onActivated).not.toHaveBeenCalled();
  });

  it('returns and emits defensive copies of the touched point', () => {
    const h = harness(); const point = checkpoint(); h.controller.activate(point);
    point.x = 400; point.roomCoordinates.x = 9;
    const copy = h.controller.getCheckpoint()!; copy.roomCoordinates.y = 9;
    const emitted = h.onActivated.mock.calls[0][0] as RespawnCheckpoint; emitted.x = 300;
    expect(h.controller.getCheckpoint()).toEqual(checkpoint());
  });
});
