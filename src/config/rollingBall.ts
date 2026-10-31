export const ROLLING_BALL_OBJECT_ID = 'rolling_ball';
export const ROLLING_BALL_RADIUS = 15;
export const ROLLING_BALL_FRAME_SIZE = 32;
export const ROLLING_BALL_COLUMNS = 8;
export const ROLLING_BALL_ROWS = 4;
export const ROLLING_BALL_FPS = 6;
const ROLLING_BALL_MIN_WEIGHT = 0.25;
const ROLLING_BALL_MAX_WEIGHT = 8;

export interface RollingBallGraphic {
  id: string;
  name: string;
  column: number;
  weight: number;
  hurtEnemies: boolean;
  hurtFriendlies: boolean;
  hurtPlayer: boolean;
  pushable: boolean;
}

export interface RollingBallSettings {
  graphicId: string;
  weight: number;
  hurtEnemies: boolean;
  hurtFriendlies: boolean;
  hurtPlayer: boolean;
  pushable: boolean;
}

const ROLLING_BALL_GRAPHICS: readonly RollingBallGraphic[] = [
  {
    id: 'basic',
    name: 'Basic Ball',
    column: 0,
    weight: 1,
    hurtEnemies: false,
    hurtFriendlies: false,
    hurtPlayer: false,
    pushable: true,
  },
];

const GRAPHICS_BY_ID = new Map(ROLLING_BALL_GRAPHICS.map((graphic) => [graphic.id, graphic]));

export function isRollingBallObjectId(id: string | null | undefined): boolean {
  return id === ROLLING_BALL_OBJECT_ID;
}

export function listRollingBallGraphics(): readonly RollingBallGraphic[] {
  return ROLLING_BALL_GRAPHICS;
}

export function getRollingBallGraphic(id: string | null | undefined): RollingBallGraphic {
  return GRAPHICS_BY_ID.get(id ?? '') ?? ROLLING_BALL_GRAPHICS[0];
}

export function rollingBallFrame(column: number, row: number): number {
  const safeColumn = Math.max(0, Math.min(ROLLING_BALL_COLUMNS - 1, Math.floor(column)));
  const safeRow = ((Math.floor(row) % ROLLING_BALL_ROWS) + ROLLING_BALL_ROWS) % ROLLING_BALL_ROWS;
  return safeRow * ROLLING_BALL_COLUMNS + safeColumn;
}

export function normalizeRollingBallWeight(value: number | null | undefined, fallback = 1): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(ROLLING_BALL_MAX_WEIGHT, Math.max(ROLLING_BALL_MIN_WEIGHT, numeric));
}

export function rollingBallSettingsFromGraphic(graphicId: string | null | undefined): RollingBallSettings {
  const graphic = getRollingBallGraphic(graphicId);
  return {
    graphicId: graphic.id,
    weight: graphic.weight,
    hurtEnemies: graphic.hurtEnemies,
    hurtFriendlies: graphic.hurtFriendlies,
    hurtPlayer: graphic.hurtPlayer,
    pushable: graphic.pushable,
  };
}

export function normalizePlacedRollingBall(placed: {
  id: string;
  ballGraphic?: string | null;
  ballWeight?: number | null;
  ballHurtEnemies?: boolean | null;
  ballHurtFriendlies?: boolean | null;
  ballHurtPlayer?: boolean | null;
  ballPushable?: boolean | null;
}): RollingBallSettings | null {
  if (!isRollingBallObjectId(placed.id)) {
    return null;
  }
  const graphic = getRollingBallGraphic(placed.ballGraphic);
  return {
    graphicId: graphic.id,
    weight: normalizeRollingBallWeight(placed.ballWeight, graphic.weight),
    hurtEnemies: placed.ballHurtEnemies ?? graphic.hurtEnemies,
    hurtFriendlies: placed.ballHurtFriendlies ?? graphic.hurtFriendlies,
    hurtPlayer: placed.ballHurtPlayer ?? graphic.hurtPlayer,
    pushable: placed.ballPushable ?? graphic.pushable,
  };
}

export function rollingBallActivatesPressurePlate(_pushable: boolean): boolean {
  return true;
}

export function rollingBallClearsTileGap(radius: number, gap: number): boolean {
  return radius * 2 < gap;
}
