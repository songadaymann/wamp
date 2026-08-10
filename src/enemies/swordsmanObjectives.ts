import type Phaser from 'phaser';
import type { SwordsmanBodySnapshot } from './swordsmanTraversal';

export const SWORDSMAN_OBJECTIVE_MODES = ['duel', 'collect'] as const;
export type SwordsmanObjectiveMode = (typeof SWORDSMAN_OBJECTIVE_MODES)[number];
export const SWORDSMAN_DEFEAT_MODES = ['defeatable', 'invincible', 'respawn'] as const;
export type SwordsmanDefeatMode = (typeof SWORDSMAN_DEFEAT_MODES)[number];
export type SwordsmanObjectiveBody = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;

export const DEFAULT_SWORDSMAN_OBJECTIVE_MODE: SwordsmanObjectiveMode = 'duel';
export const DEFAULT_SWORDSMAN_DEFEAT_MODE: SwordsmanDefeatMode = 'defeatable';

export const SWORDSMAN_OBJECTIVE_MODE_LABELS: Record<SwordsmanObjectiveMode, string> = {
  duel: 'Hunt Player',
  collect: 'Collect Items',
};

export const SWORDSMAN_DEFEAT_MODE_LABELS: Record<SwordsmanDefeatMode, string> = {
  defeatable: 'Can Die',
  invincible: "Can't Die",
  respawn: 'Respawns',
};

export function normalizeSwordsmanObjectiveMode(value: unknown): SwordsmanObjectiveMode | null {
  return value === 'duel' || value === 'collect' ? value : null;
}

export function normalizeSwordsmanDefeatMode(value: unknown): SwordsmanDefeatMode | null {
  return value === 'defeatable' || value === 'invincible' || value === 'respawn'
    ? value
    : null;
}

export interface SwordsmanObjectiveTarget {
  kind: 'player' | 'collectible';
  body: SwordsmanObjectiveBody;
  directionX: -1 | 1;
  withinActionRange: boolean;
  traversalSnapshot?: SwordsmanBodySnapshot | null;
  opportunisticJump?: {
    directionX: -1 | 1;
    targetX: number;
    velocityX: number;
    velocityY: number;
  } | null;
}

export interface BuildSwordsmanDuelObjectiveTargetOptions {
  enemyBody: Phaser.Physics.Arcade.Body;
  playerBody: Phaser.Physics.Arcade.Body | null;
  roomOrigin: { x: number; y: number };
  roomWidthPx: number;
  roomHeightPx: number;
  chaseRangeX: number;
  chaseRangeY: number;
  attackRangeX: number;
  attackRangeY: number;
}

export function buildSwordsmanDuelObjectiveTarget(
  options: BuildSwordsmanDuelObjectiveTargetOptions,
): SwordsmanObjectiveTarget | null {
  const {
    enemyBody,
    playerBody,
    roomOrigin,
    roomWidthPx,
    roomHeightPx,
    chaseRangeX,
    chaseRangeY,
    attackRangeX,
    attackRangeY,
  } = options;

  if (!playerBody) {
    return null;
  }

  if (
    playerBody.center.x < roomOrigin.x ||
    playerBody.center.x > roomOrigin.x + roomWidthPx ||
    playerBody.center.y < roomOrigin.y ||
    playerBody.center.y > roomOrigin.y + roomHeightPx
  ) {
    return null;
  }

  const deltaX = playerBody.center.x - enemyBody.center.x;
  const deltaY = playerBody.center.y - enemyBody.center.y;
  if (Math.abs(deltaX) > chaseRangeX || Math.abs(deltaY) > chaseRangeY) {
    return null;
  }

  return {
    kind: 'player',
    body: playerBody,
    directionX: deltaX >= 0 ? 1 : -1,
    withinActionRange: Math.abs(deltaX) <= attackRangeX && Math.abs(deltaY) <= attackRangeY,
  };
}
