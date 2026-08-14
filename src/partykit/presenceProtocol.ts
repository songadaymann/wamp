import type { RoomChatSayMessage, RoomChatTransportChannel } from '../chat/roomChatModel';
import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';
import type {
  PvpInviteAcceptMessage,
  PvpInviteDeclineMessage,
  PvpInviteSendMessage,
} from '../pvp/model';

export type PresenceMode = 'browse' | 'play' | 'edit';

export type PresenceAnimationState =
  | 'idle'
  | 'run'
  | 'jump-rise'
  | 'jump-fall'
  | 'wall-slide'
  | 'wall-jump'
  | 'land'
  | 'ladder-climb'
  | 'crouch'
  | 'crawl'
  | 'push'
  | 'pull'
  | 'sword-slash'
  | 'air-slash-down'
  | 'gun-fire';

export interface PresencePvpState {
  matchId: string;
  action: 'sword' | 'gun' | null;
  actionUntil: number;
}

export interface PresencePayload {
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: PresenceAnimationState;
  mode: PresenceMode;
  pvp?: PresencePvpState | null;
  timestamp: number;
}

export interface RoomPreviewPayload {
  roomCoordinates: RoomCoordinates;
  snapshot: RoomSnapshot;
  timestamp: number;
  constructionPreviewToken?: string;
}

export interface ConnectionPresenceState {
  channel: RoomChatTransportChannel;
  userId: string;
  displayName: string;
  avatarId: string;
  presence: PresencePayload | null;
  lastRoomChatSentAt: number;
  lastPvpInviteSentAt: number;
}

export interface WorldGhostPresence extends PresencePayload {
  connectionId: string;
  userId: string;
  displayName: string;
  avatarId: string;
  shardId: string;
  roomId: string;
}

export interface SharedRoomPreview extends Omit<RoomPreviewPayload, 'constructionPreviewToken'> {
  roomId: string;
  userId: string;
  displayName: string;
  shardId: string;
}

export type IncomingMessage =
  | {
      type: 'presence:update';
      presence: PresencePayload;
    }
  | {
      type: 'presence:preview:update';
      preview: RoomPreviewPayload;
    }
  | {
      type: 'presence:preview:clear';
      roomCoordinates?: RoomCoordinates;
      timestamp?: number;
    }
  | {
      type: 'presence:leave';
    }
  | PvpInviteSendMessage
  | PvpInviteAcceptMessage
  | PvpInviteDeclineMessage
  | RoomChatSayMessage;

export function parseIncomingMessage(message: string): IncomingMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(message) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
    return null;
  }

  return parsed as IncomingMessage;
}

export function normalizePresencePayload(value: unknown): PresencePayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Partial<PresencePayload>;
  if (
    !payload.roomCoordinates ||
    !Number.isInteger(payload.roomCoordinates.x) ||
    !Number.isInteger(payload.roomCoordinates.y) ||
    typeof payload.x !== 'number' ||
    typeof payload.y !== 'number' ||
    typeof payload.velocityX !== 'number' ||
    typeof payload.velocityY !== 'number' ||
    typeof payload.facing !== 'number' ||
    typeof payload.timestamp !== 'number'
  ) {
    return null;
  }

  const animationState = payload.animationState;
  if (!isPresenceAnimationState(animationState)) {
    return null;
  }

  if (payload.mode !== 'browse' && payload.mode !== 'play' && payload.mode !== 'edit') {
    return null;
  }

  return {
    roomCoordinates: {
      x: payload.roomCoordinates.x,
      y: payload.roomCoordinates.y,
    },
    x: payload.x,
    y: payload.y,
    velocityX: payload.velocityX,
    velocityY: payload.velocityY,
    facing: payload.facing < 0 ? -1 : 1,
    animationState,
    mode: payload.mode,
    pvp: normalizePresencePvpState(payload.pvp),
    timestamp: payload.timestamp,
  };
}

export function isVisiblePresence(
  presence: PresencePayload | null | undefined,
): presence is PresencePayload {
  return Boolean(
    presence &&
      (presence.mode === 'browse' || presence.mode === 'play' || presence.mode === 'edit'),
  );
}

function isPresenceAnimationState(value: unknown): value is PresenceAnimationState {
  return (
    value === 'idle' ||
    value === 'run' ||
    value === 'jump-rise' ||
    value === 'jump-fall' ||
    value === 'wall-slide' ||
    value === 'wall-jump' ||
    value === 'land' ||
    value === 'ladder-climb' ||
    value === 'crouch' ||
    value === 'crawl' ||
    value === 'push' ||
    value === 'pull' ||
    value === 'sword-slash' ||
    value === 'air-slash-down' ||
    value === 'gun-fire'
  );
}

function normalizePresencePvpState(value: unknown): PresencePvpState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<PresencePvpState>;
  const matchId = normalizePresenceMatchId(raw.matchId);
  if (!matchId) {
    return null;
  }

  const action = raw.action === 'sword' || raw.action === 'gun' ? raw.action : null;
  const actionUntil = Number(raw.actionUntil ?? 0);
  return {
    matchId,
    action,
    actionUntil: Number.isFinite(actionUntil) ? actionUntil : 0,
  };
}

function normalizePresenceMatchId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().slice(0, 96);
  return normalized.length > 0 ? normalized : null;
}
