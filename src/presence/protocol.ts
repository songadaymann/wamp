import type { RoomCoordinates } from '../persistence/roomModel';

export const WORLD_PRESENCE_MODES = ['browse', 'play', 'edit'] as const;
export type WorldPresenceMode = (typeof WORLD_PRESENCE_MODES)[number];

export const WORLD_PRESENCE_ANIMATION_STATES = [
  'idle',
  'run',
  'jump-rise',
  'jump-fall',
  'wall-slide',
  'wall-jump',
  'land',
  'ladder-climb',
  'crouch',
  'crawl',
  'push',
  'pull',
  'sword-slash',
  'air-slash-down',
  'gun-fire',
] as const;
export type WorldPresenceAnimationState = (typeof WORLD_PRESENCE_ANIMATION_STATES)[number];

export interface WorldPresenceIdentity {
  userId: string;
  displayName: string;
  avatarId: string;
}

export interface WorldPresencePayload {
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: WorldPresenceAnimationState;
  mode: WorldPresenceMode;
  timestamp: number;
}

export interface WorldGhostPresence extends WorldPresencePayload {
  connectionId: string;
  userId: string;
  displayName: string;
  avatarId: string;
  shardId: string;
  roomId: string;
}

export interface PresenceSnapshotMessage {
  type: 'snapshot';
  peers: WorldGhostPresence[];
  roomPopulations: Record<string, number>;
  roomEditors: Record<string, number>;
}

export interface PresenceUpsertMessage {
  type: 'upsert';
  peer: WorldGhostPresence;
}

export interface PresenceRemoveMessage {
  type: 'remove';
  connectionId: string;
}

export interface PresencePopulationsMessage {
  type: 'populations';
  roomPopulations: Record<string, number>;
  roomEditors: Record<string, number>;
}

export type PresenceServerMessage =
  | PresenceSnapshotMessage
  | PresenceUpsertMessage
  | PresenceRemoveMessage
  | PresencePopulationsMessage;

export interface PresencePublishMessage {
  type: 'presence:update';
  presence: WorldPresencePayload;
}

export interface PresenceLeaveMessage {
  type: 'presence:leave';
}

export type PresenceClientMessage = PresencePublishMessage | PresenceLeaveMessage;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object';
}

function isCountMap(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((count) => typeof count === 'number' && Number.isFinite(count));
}

function isRoomCoordinates(value: unknown): value is RoomCoordinates {
  if (!isRecord(value)) {
    return false;
  }

  return Number.isInteger(value.x) && Number.isInteger(value.y);
}

export function isWorldPresenceMode(value: unknown): value is WorldPresenceMode {
  return typeof value === 'string' && WORLD_PRESENCE_MODES.includes(value as WorldPresenceMode);
}

export function isWorldPresenceAnimationState(
  value: unknown
): value is WorldPresenceAnimationState {
  return (
    typeof value === 'string' &&
    WORLD_PRESENCE_ANIMATION_STATES.includes(value as WorldPresenceAnimationState)
  );
}

export function isWorldPresencePayload(value: unknown): value is WorldPresencePayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRoomCoordinates(value.roomCoordinates) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.velocityX === 'number' &&
    Number.isFinite(value.velocityX) &&
    typeof value.velocityY === 'number' &&
    Number.isFinite(value.velocityY) &&
    typeof value.facing === 'number' &&
    Number.isFinite(value.facing) &&
    isWorldPresenceAnimationState(value.animationState) &&
    isWorldPresenceMode(value.mode) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp)
  );
}

export function isWorldGhostPresence(value: unknown): value is WorldGhostPresence {
  if (!isRecord(value) || !isWorldPresencePayload(value)) {
    return false;
  }

  return (
    typeof value['connectionId'] === 'string' &&
    typeof value['userId'] === 'string' &&
    typeof value['displayName'] === 'string' &&
    typeof value['avatarId'] === 'string' &&
    typeof value['shardId'] === 'string' &&
    typeof value['roomId'] === 'string'
  );
}

export function isPresenceClientMessage(value: unknown): value is PresenceClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'presence:leave') {
    return true;
  }

  if (value.type === 'presence:update') {
    return isWorldPresencePayload(value.presence);
  }

  return false;
}

export function isPresenceServerMessage(value: unknown): value is PresenceServerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'snapshot':
      return (
        Array.isArray(value.peers) &&
        value.peers.every((peer) => isWorldGhostPresence(peer)) &&
        isCountMap(value.roomPopulations) &&
        isCountMap(value.roomEditors)
      );
    case 'upsert':
      return isWorldGhostPresence(value.peer);
    case 'remove':
      return typeof value.connectionId === 'string';
    case 'populations':
      return isCountMap(value.roomPopulations) && isCountMap(value.roomEditors);
    default:
      return false;
  }
}
