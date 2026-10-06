import { describe, expect, it } from 'vitest';
import { ROOM_PX_HEIGHT } from '../config/room';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, createRoomVersionRecord } from '../persistence/roomModel';
import { buildRoomVersionFingerprint } from '../persistence/roomVersionLineage';
import { parseRoomSnapshot } from '../cloudflare/worker/core/http';
import { getObjectRespawnCheckpointPoint } from './respawnCheckpoints';

describe('authored respawn checkpoint flags', () => {
  it('uses the flag bottom as a feet anchor and keeps its point in the room', () => {
    expect(getObjectRespawnCheckpointPoint({ id: 'checkpoint_flag', instanceId: 'cp', x: 120, y: 240 }))
      .toEqual({ x: 120, y: 256 });
    expect(getObjectRespawnCheckpointPoint({ id: 'checkpoint_flag', instanceId: 'cp', x: 120, y: ROOM_PX_HEIGHT }))
      .toEqual({ x: 120, y: ROOM_PX_HEIGHT });
    expect(getObjectRespawnCheckpointPoint({ id: 'flag', instanceId: 'finish', x: 120, y: 240 })).toBeNull();
  });

  it('round-trips several flags through the actual write parser, snapshots and publication history', async () => {
    const room = createDefaultRoomSnapshot();
    room.placedObjects = [0,1].map(index => ({ id: 'checkpoint_flag', instanceId: `cp-${index}`, x: 100 + index * 80, y: 240 }));
    const parsed = await parseRoomSnapshot(new Request('https://example.test/api/rooms/0,0', {
      method: 'PUT', body: JSON.stringify(room),
    }), room.id);
    expect(parsed.placedObjects).toHaveLength(2);
    expect(cloneRoomSnapshot(parsed).placedObjects.map(object => object.id)).toEqual(['checkpoint_flag','checkpoint_flag']);
    expect(createRoomVersionRecord(parsed).snapshot.placedObjects).toEqual(parsed.placedObjects);
    expect(buildRoomVersionFingerprint(parsed)).not.toBe(buildRoomVersionFingerprint(createDefaultRoomSnapshot()));
  });
});
