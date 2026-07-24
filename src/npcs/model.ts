import type { PlacedObject } from '../config';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  normalizeSwordsmanDefeatMode,
  type SwordsmanDefeatMode,
} from '../enemies/swordsmanObjectives';

export const JIMOTHY_OBJECT_ID = 'jimothy' as const;
export const NPC_OBJECT_IDS = [JIMOTHY_OBJECT_ID] as const;
export type NpcObjectId = (typeof NPC_OBJECT_IDS)[number];

export const NPC_MODES = ['idle', 'wander', 'patrol', 'follow'] as const;
export type NpcMode = (typeof NPC_MODES)[number];

export const DEFAULT_NPC_MODE: NpcMode = 'idle';
export const DEFAULT_NPC_DEFEAT_MODE: SwordsmanDefeatMode =
  DEFAULT_SWORDSMAN_DEFEAT_MODE;
export const DEFAULT_NPC_PLAYER_COLLISION = true;
export const DEFAULT_NPC_FRIENDLY_FIRE = true;
export const NPC_NAME_MAX_LENGTH = 32;
export const NPC_DIALOGUE_MAX_LENGTH = 140;

export const NPC_MODE_LABELS: Record<NpcMode, string> = {
  idle: 'Idle',
  wander: 'Wander',
  patrol: 'Patrol',
  follow: 'Follow',
};

export const JIMOTHY_ANIMATION_KEYS = {
  idle: 'jimothy_idle',
  walk: 'jimothy_walk',
  death: 'jimothy_death',
  victory: 'jimothy_victory',
} as const;

export function isNpcObjectId(id: string): id is NpcObjectId {
  return (NPC_OBJECT_IDS as readonly string[]).includes(id);
}

export function normalizeNpcMode(value: unknown): NpcMode | null {
  return (NPC_MODES as readonly unknown[]).includes(value) ? (value as NpcMode) : null;
}

export function normalizeNpcName(value: unknown, fallbackName = ''): string {
  if (typeof value !== 'string') {
    return fallbackName.trim().slice(0, NPC_NAME_MAX_LENGTH);
  }

  return value.replace(/\r\n?/g, ' ').trim().slice(0, NPC_NAME_MAX_LENGTH);
}

export function normalizeNpcPushable(value: unknown, mode: NpcMode): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return mode !== 'idle';
}

export function normalizeNpcCanJumpFall(value: unknown, mode: NpcMode): boolean {
  if (mode === 'follow') {
    return true;
  }

  return typeof value === 'boolean' ? value : false;
}

export function normalizeNpcPlayerCollision(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_NPC_PLAYER_COLLISION;
}

export function normalizeNpcFriendlyFire(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_NPC_FRIENDLY_FIRE;
}

export function normalizeNpcDefeatMode(value: unknown): SwordsmanDefeatMode {
  return normalizeSwordsmanDefeatMode(value) ?? DEFAULT_NPC_DEFEAT_MODE;
}

export function getPlacedNpcMode(
  placed: Pick<PlacedObject, 'id' | 'npcMode'> | null | undefined,
): NpcMode {
  if (!isNpcObjectId(placed?.id ?? '')) {
    return DEFAULT_NPC_MODE;
  }

  return normalizeNpcMode(placed?.npcMode) ?? DEFAULT_NPC_MODE;
}

export function getPlacedNpcName(
  placed: Pick<PlacedObject, 'id' | 'npcName'> | null | undefined,
  objectName: string,
): string {
  if (!isNpcObjectId(placed?.id ?? '')) {
    return '';
  }

  return normalizeNpcName(placed?.npcName, objectName);
}

export function getPlacedNpcDefeatMode(
  placed: Pick<PlacedObject, 'id' | 'npcDefeatMode'> | null | undefined,
): SwordsmanDefeatMode {
  if (!isNpcObjectId(placed?.id ?? '')) {
    return DEFAULT_NPC_DEFEAT_MODE;
  }

  return normalizeNpcDefeatMode(placed?.npcDefeatMode);
}
