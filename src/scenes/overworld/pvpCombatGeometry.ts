export interface PvpCombatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PvpCombatVelocity {
  x: number;
  y: number;
}

export interface PvpPeerCollisionResolution {
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
}

export function getPvpRectRight(rect: PvpCombatRect): number {
  return rect.x + rect.width;
}

export function getPvpRectBottom(rect: PvpCombatRect): number {
  return rect.y + rect.height;
}

export function getPvpRectCenterX(rect: PvpCombatRect): number {
  return rect.x + rect.width * 0.5;
}

export function getPvpRectCenterY(rect: PvpCombatRect): number {
  return rect.y + rect.height * 0.5;
}

export function inflatePvpCombatRect(
  rect: PvpCombatRect,
  x: number,
  y: number,
): PvpCombatRect {
  return {
    x: rect.x - x,
    y: rect.y - y,
    width: rect.width + x * 2,
    height: rect.height + y * 2,
  };
}

export function pvpCombatRectsIntersect(a: PvpCombatRect, b: PvpCombatRect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }

  return !(
    getPvpRectRight(a) < b.x ||
    getPvpRectBottom(a) < b.y ||
    a.x > getPvpRectRight(b) ||
    a.y > getPvpRectBottom(b)
  );
}

export function createPvpPointHitRect(worldX: number, worldY: number): PvpCombatRect {
  return { x: worldX - 4, y: worldY - 3, width: 8, height: 6 };
}

export function createPvpPlayerBodyRect(input: {
  left: number;
  top: number;
  width: number;
  height: number;
}): PvpCombatRect {
  return {
    x: input.left,
    y: input.top,
    width: input.width,
    height: input.height,
  };
}

export function createPvpGhostBodyRect(input: {
  x: number;
  feetY: number;
  playerWidth: number;
  playerHeight: number;
}): PvpCombatRect {
  return {
    x: input.x - input.playerWidth * 0.5,
    y: input.feetY - input.playerHeight,
    width: input.playerWidth,
    height: input.playerHeight,
  };
}

export function createPvpGhostHitRect(bodyRect: PvpCombatRect): PvpCombatRect {
  return inflatePvpCombatRect(bodyRect, 12, 8);
}

export function createPvpRemoteActionDamageRect(input: {
  bodyRect: PvpCombatRect;
  facing: -1 | 1;
  action: 'sword' | 'gun';
  downward?: boolean;
}): PvpCombatRect {
  const { bodyRect, facing, action } = input;
  if (action === 'gun') {
    const width = 88;
    return inflatePvpCombatRect({
      x: facing > 0 ? getPvpRectCenterX(bodyRect) : getPvpRectCenterX(bodyRect) - width,
      y: getPvpRectCenterY(bodyRect) - 12,
      width,
      height: 24,
    }, 8, 4);
  }

  const swordRect = input.downward
    ? {
        x: getPvpRectCenterX(bodyRect) - 12,
        y: getPvpRectBottom(bodyRect) - 2,
        width: 24,
        height: 28,
      }
    : {
        x: getPvpRectCenterX(bodyRect) + facing * 8 - 14,
        y: bodyRect.y + 2,
        width: 28,
        height: bodyRect.height + 10,
      };
  return inflatePvpCombatRect(swordRect, 14, 8);
}

export function isPvpStompContact(input: {
  playerRect: PvpCombatRect;
  targetRect: PvpCombatRect;
  playerVelocityY: number;
}): boolean {
  return (
    pvpCombatRectsIntersect(input.playerRect, input.targetRect) &&
    isPvpStompVerticalContact(input)
  );
}

export function isPvpStompVerticalContact(input: {
  playerRect: PvpCombatRect;
  targetRect: PvpCombatRect;
  playerVelocityY: number;
}): boolean {
  return (
    input.playerVelocityY > 40 &&
    getPvpRectBottom(input.playerRect) <= input.targetRect.y + 10
  );
}

export function resolvePvpPeerCollision(input: {
  playerRect: PvpCombatRect;
  targetRect: PvpCombatRect;
  velocity: PvpCombatVelocity;
}): PvpPeerCollisionResolution | null {
  const { playerRect, targetRect, velocity } = input;
  if (!pvpCombatRectsIntersect(playerRect, targetRect)) {
    return null;
  }

  const leftOverlap = getPvpRectRight(playerRect) - targetRect.x;
  const rightOverlap = getPvpRectRight(targetRect) - playerRect.x;
  const topOverlap = getPvpRectBottom(playerRect) - targetRect.y;
  const bottomOverlap = getPvpRectBottom(targetRect) - playerRect.y;
  const overlapX = Math.min(leftOverlap, rightOverlap);
  const overlapY = Math.min(topOverlap, bottomOverlap);
  if (overlapX <= 0 || overlapY <= 0) {
    return null;
  }

  const fallingOntoOpponent =
    velocity.y >= 0 &&
    getPvpRectCenterY(playerRect) < getPvpRectCenterY(targetRect) &&
    topOverlap <= 12 &&
    topOverlap <= overlapX + 2;

  if (fallingOntoOpponent) {
    return {
      offsetX: 0,
      offsetY: -topOverlap - 0.5,
      velocityX: velocity.x,
      velocityY: Math.min(0, velocity.y),
    };
  }

  const offsetX = getPvpRectCenterX(playerRect) < getPvpRectCenterX(targetRect)
    ? -overlapX - 0.5
    : overlapX + 0.5;
  const movingIntoOpponent =
    (offsetX < 0 && velocity.x > 0) || (offsetX > 0 && velocity.x < 0);
  return {
    offsetX,
    offsetY: 0,
    velocityX: movingIntoOpponent ? 0 : velocity.x,
    velocityY: velocity.y,
  };
}
