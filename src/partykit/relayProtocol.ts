import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  type RoomChatBroadcastMessage,
} from '../chat/roomChatModel';
import type {
  PvpInviteAcceptMessage,
  PvpInviteDeclineMessage,
  PvpInviteSendMessage,
  PvpParticipantIdentity,
  PvpPresenceServerMessage,
} from '../pvp/model';
import type { ConnectionPresenceState } from './presenceProtocol';
import { roomIdFromPresenceCoordinates } from './presencePopulation';

export const PVP_INVITE_SEND_RATE_LIMIT_MS = 3_000;
/** A challenge stays open at most this long, whatever the sender asks for. */
export const PVP_INVITE_MAX_LIFETIME_MS = 30_000;
/** After a decline, the same sender can't challenge the same player again for this long. */
export const PVP_INVITE_DECLINE_COOLDOWN_MS = 60_000;
/** One challenge per receiver in this window, from anyone, so several senders can't take turns. */
export const PVP_INVITE_TARGET_INTERVAL_MS = 10_000;

/** Per-shard limits on who may challenge whom, keyed by user so reconnecting doesn't reset them. */
export class PvpInviteLimiter {
  private readonly lastOfferAtByTarget = new Map<string, number>();
  private readonly cooldownUntilByPair = new Map<string, number>();

  allows(senderUserId: string, targetUserId: string, now: number): boolean {
    this.prune(now);
    return (this.cooldownUntilByPair.get(`${senderUserId}\n${targetUserId}`) ?? 0) <= now
      && now - (this.lastOfferAtByTarget.get(targetUserId) ?? -Infinity) >= PVP_INVITE_TARGET_INTERVAL_MS;
  }

  recordOffer(targetUserId: string, now: number): void {
    this.lastOfferAtByTarget.set(targetUserId, now);
  }

  recordDecline(senderUserId: string, targetUserId: string, now: number): void {
    this.cooldownUntilByPair.set(`${senderUserId}\n${targetUserId}`, now + PVP_INVITE_DECLINE_COOLDOWN_MS);
  }

  private prune(now: number): void {
    for (const [target, at] of this.lastOfferAtByTarget) if (now - at >= PVP_INVITE_TARGET_INTERVAL_MS) this.lastOfferAtByTarget.delete(target);
    for (const [pair, until] of this.cooldownUntilByPair) if (until <= now) this.cooldownUntilByPair.delete(pair);
  }
}

export function normalizeRoomChatText(rawText: unknown): string | null {
  if (typeof rawText !== 'string') return null;
  const text = rawText.trim();
  return text.length > 0 && text.length <= ROOM_CHAT_MESSAGE_MAX_LENGTH ? text : null;
}

export function buildRoomChatBroadcast(
  state: Exclude<ConnectionPresenceState, null>,
  shardId: string,
  text: string,
  now: number,
  id: string,
  lifetimeMs: number,
): RoomChatBroadcastMessage {
  const roomCoordinates = state.presence!.roomCoordinates;
  return {
    type: 'room-chat:message',
    message: {
      id,
      shardId,
      userId: state.userId,
      displayName: state.displayName,
      avatarId: state.avatarId,
      roomCoordinates: { ...roomCoordinates },
      roomId: roomIdFromPresenceCoordinates(roomCoordinates),
      text,
      createdAt: now,
      expiresAt: now + lifetimeMs,
    },
  };
}

export function normalizePvpInviteSend(
  message: PvpInviteSendMessage,
  now: number,
): PvpInviteSendMessage['invite'] | null {
  const invite = message.invite;
  if (!invite || invite.mode !== 'arena') return null;
  const roomCoordinates = normalizeRoomCoordinates(invite.roomCoordinates);
  const inviteId = normalizeShortId(invite.inviteId, 80);
  const matchId = normalizeShortId(invite.matchId, 96);
  const roomId = normalizeShortId(invite.roomId, 80);
  const targetConnectionId = normalizeShortId(invite.targetConnectionId, 96);
  if (!roomCoordinates || !inviteId || !matchId || !roomId || !targetConnectionId) return null;
  return {
    ...invite,
    inviteId,
    matchId,
    mode: 'arena',
    roomId,
    roomCoordinates,
    targetConnectionId,
    target: normalizePvpParticipant(invite.target) ?? {
      userId: '', displayName: 'Player', avatarId: 'default-player',
    },
    expiresAt: Math.min(now + PVP_INVITE_MAX_LIFETIME_MS, Math.max(now + 5_000, Number(invite.expiresAt) || 0)),
  };
}

export function buildPvpInviteOffer(
  invite: PvpInviteSendMessage['invite'],
  inviterConnectionId: string,
  inviter: PvpParticipantIdentity,
  target: PvpParticipantIdentity,
  shardId: string,
  now: number,
): PvpPresenceServerMessage {
  return {
    type: 'pvp:invite:offer',
    invite: {
      inviteId: invite.inviteId,
      matchId: invite.matchId,
      mode: invite.mode,
      roomId: invite.roomId,
      roomCoordinates: { ...invite.roomCoordinates },
      shardId,
      inviterConnectionId,
      inviter,
      target,
      createdAt: now,
      expiresAt: invite.expiresAt,
    },
  };
}

export function buildPvpInviteAccepted(
  message: PvpInviteAcceptMessage,
  acceptedBy: PvpParticipantIdentity,
): PvpPresenceServerMessage {
  return {
    type: 'pvp:invite:accepted',
    inviteId: String(message.inviteId ?? '').slice(0, 80),
    matchId: String(message.matchId ?? '').slice(0, 96),
    acceptedBy,
  };
}

export function buildPvpInviteDeclined(
  message: PvpInviteDeclineMessage,
  declinedBy: PvpParticipantIdentity,
): PvpPresenceServerMessage {
  return {
    type: 'pvp:invite:declined',
    inviteId: String(message.inviteId ?? '').slice(0, 80),
    matchId: String(message.matchId ?? '').slice(0, 96),
    declinedBy,
  };
}

export function identityFromPresenceState(
  state: ConnectionPresenceState,
): PvpParticipantIdentity {
  return { userId: state!.userId, displayName: state!.displayName, avatarId: state!.avatarId };
}

function normalizePvpParticipant(value: unknown): PvpParticipantIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PvpParticipantIdentity>;
  const userId = normalizeShortId(raw.userId, 96);
  const displayName = normalizeShortId(raw.displayName, 80);
  const avatarId = normalizeShortId(raw.avatarId, 96);
  return userId && displayName && avatarId ? { userId, displayName, avatarId } : null;
}

function normalizeRoomCoordinates(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { x?: unknown; y?: unknown };
  return Number.isInteger(raw.x) && Number.isInteger(raw.y)
    ? { x: raw.x as number, y: raw.y as number }
    : null;
}

function normalizeShortId(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : null;
}
