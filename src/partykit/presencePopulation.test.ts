import { describe, expect, it } from 'vitest';
import type { ConnectionPresenceState } from './presenceProtocol';
import {
  computePresenceRoomCounts,
  listWorldGhostPeers,
  roomIdFromUnknownCoordinates,
  shouldBroadcastPresencePopulations,
  toWorldGhostPresence,
} from './presencePopulation';

describe('PartyKit presence population model', () => {
  it('builds sorted ghosts while omitting the viewer connection and every same-user socket', () => {
    const viewer = connection('viewer', state('same-user', 'Viewer', 1, 1, 'play'));
    const duplicate = connection('duplicate', state('same-user', 'Viewer copy', 1, 1, 'play'));
    const zoe = connection('zoe', state('zoe-user', 'Zoe', 2, 2, 'play'));
    const amy = connection('amy', state('amy-user', 'Amy', 3, 3, 'browse'));

    expect(listWorldGhostPeers([viewer, duplicate, zoe, amy], viewer, 'shard-1'))
      .toEqual([
        expect.objectContaining({ connectionId: 'amy', displayName: 'Amy', roomId: '3,3' }),
        expect.objectContaining({ connectionId: 'zoe', displayName: 'Zoe', roomId: '2,2' }),
      ]);
    expect(toWorldGhostPresence(zoe, 'shard-1')).toMatchObject({ shardId: 'shard-1' });
  });

  it('counts only the requested channel/mode and sorts room ids', () => {
    const connections = [
      connection('b', state('b', 'B', 8, 9, 'play')),
      connection('a', state('a', 'A', 1, 2, 'play')),
      connection('c', state('c', 'C', 8, 9, 'edit')),
      connection('chat', { ...state('chat', 'Chat', 1, 2, 'play'), channel: 'room-chat' }),
    ];
    expect(computePresenceRoomCounts(connections, 'play')).toEqual({ '1,2': 1, '8,9': 1 });
    expect(computePresenceRoomCounts(connections, 'edit')).toEqual({ '8,9': 1 });
  });

  it('detects population mode/room changes and validates unknown coordinates', () => {
    const play = state('a', 'A', 1, 2, 'play').presence;
    const moved = state('a', 'A', 2, 2, 'play').presence;
    const edit = state('a', 'A', 1, 2, 'edit').presence;
    expect(shouldBroadcastPresencePopulations(play, play)).toBe(false);
    expect(shouldBroadcastPresencePopulations(play, moved)).toBe(true);
    expect(shouldBroadcastPresencePopulations(play, edit)).toBe(true);
    expect(roomIdFromUnknownCoordinates({ x: -1, y: 2 })).toBe('-1,2');
    expect(roomIdFromUnknownCoordinates({ x: 1.5, y: 2 })).toBeNull();
  });
});

function state(
  userId: string,
  displayName: string,
  roomX: number,
  roomY: number,
  mode: 'browse' | 'play' | 'edit',
): Exclude<ConnectionPresenceState, null> {
  return {
    channel: 'presence',
    userId,
    displayName,
    avatarId: `avatar-${userId}`,
    presence: {
      roomCoordinates: { x: roomX, y: roomY },
      x: 10,
      y: 20,
      velocityX: 0,
      velocityY: 0,
      facing: 1,
      animationState: 'idle',
      mode,
      timestamp: 1,
    },
    lastRoomChatSentAt: 0,
    lastPvpInviteSentAt: 0,
  };
}

function connection(id: string, connectionState: Exclude<ConnectionPresenceState, null>) {
  return { id, state: connectionState } as never;
}
