import { describe, expect, it } from 'vitest';
import {
  buildPvpInviteAccepted,
  buildPvpInviteDeclined,
  buildPvpInviteOffer,
  buildRoomChatBroadcast,
  normalizePvpInviteSend,
  normalizeRoomChatText,
} from './relayProtocol';

describe('PartyKit relay protocol', () => {
  it('normalizes bounded chat and builds the unchanged expiring room payload', () => {
    expect(normalizeRoomChatText(' hi ')).toBe('hi');
    expect(normalizeRoomChatText(' ')).toBeNull();
    expect(normalizeRoomChatText('x'.repeat(141))).toBeNull();
    const state = { userId: 'u', displayName: 'U', avatarId: 'a', presence: { roomCoordinates: { x: 1, y: 2 } } } as never;
    expect(buildRoomChatBroadcast(state, 'shard', 'hi', 100, 'id', 6_000)).toEqual({
      type: 'room-chat:message', message: { id: 'id', shardId: 'shard', userId: 'u', displayName: 'U', avatarId: 'a', roomCoordinates: { x: 1, y: 2 }, roomId: '1,2', text: 'hi', createdAt: 100, expiresAt: 6_100 },
    });
  });

  it('normalizes invite identifiers, coordinates, target fallback, and minimum expiry', () => {
    const message = { type: 'pvp:invite', invite: { inviteId: ' id ', matchId: ' match ', mode: 'arena', roomId: ' room ', roomCoordinates: { x: 1, y: 2 }, targetConnectionId: ' target ', target: {}, expiresAt: 0 } } as never;
    expect(normalizePvpInviteSend(message, 100)).toEqual({
      inviteId: 'id', matchId: 'match', mode: 'arena', roomId: 'room', roomCoordinates: { x: 1, y: 2 }, targetConnectionId: 'target', target: { userId: '', displayName: 'Player', avatarId: 'default-player' }, expiresAt: 5_100,
    });
    expect(normalizePvpInviteSend({ type: 'pvp:invite', invite: { mode: 'other' } } as never, 100)).toBeNull();
  });

  it('builds offer/accept/decline messages with legacy slicing rather than trimming', () => {
    const identity = { userId: 'u', displayName: 'U', avatarId: 'a' };
    const invite = normalizePvpInviteSend({ type: 'pvp:invite', invite: { inviteId: 'i', matchId: 'm', mode: 'arena', roomId: 'r', roomCoordinates: { x: 1, y: 2 }, targetConnectionId: 't', target: identity, expiresAt: 9_000 } }, 0)!;
    expect(buildPvpInviteOffer(invite, 'c', identity, identity, 's', 10)).toMatchObject({ type: 'pvp:invite:offer', invite: { createdAt: 10, shardId: 's', inviterConnectionId: 'c' } });
    const raw = { inviteId: ` ${'i'.repeat(90)}`, matchId: ` ${'m'.repeat(100)}` };
    expect(buildPvpInviteAccepted({ type: 'pvp:invite:accept', inviterConnectionId: 'c', ...raw }, identity)).toMatchObject({ type: 'pvp:invite:accepted', inviteId: raw.inviteId.slice(0, 80), matchId: raw.matchId.slice(0, 96) });
    expect(buildPvpInviteDeclined({ type: 'pvp:invite:decline', inviterConnectionId: 'c', ...raw }, identity)).toMatchObject({ type: 'pvp:invite:declined' });
  });
});
