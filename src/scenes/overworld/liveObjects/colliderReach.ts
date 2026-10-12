// F008: a moving object only gets physics colliders for the loaded rooms its body is near,
// instead of every loaded room. Its reach grows (never shrinks) as it moves, until the next
// full collider sync rebuilds everything from current positions.

export interface WorldRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Rooms within this distance of a body (plus its lookahead) join its reach. */
export const REACH_BUILD_MARGIN_PX = 160;
export const REACH_BUILD_LOOKAHEAD_S = 0.5;
/** A body this close (plus its lookahead) to a room outside its reach makes the reach grow. */
export const REACH_CHECK_MARGIN_PX = 64;
export const REACH_CHECK_LOOKAHEAD_S = 0.25;

interface BodyLike {
  left?: unknown;
  right?: unknown;
  top?: unknown;
  bottom?: unknown;
  velocity?: { x?: unknown; y?: unknown } | null;
}

/** The body's world rectangle, or null when the body has no usable bounds. */
export function readBodyRect(body: unknown): WorldRect | null {
  const candidate = body as BodyLike | null;
  if (!candidate) return null;
  const { left, right, top, bottom } = candidate;
  if (
    typeof left !== 'number' || typeof right !== 'number'
    || typeof top !== 'number' || typeof bottom !== 'number'
    || !Number.isFinite(left) || !Number.isFinite(right)
    || !Number.isFinite(top) || !Number.isFinite(bottom)
  ) {
    return null;
  }
  return { left, right, top, bottom };
}

export function readBodySpeed(body: unknown): number {
  const velocity = (body as BodyLike | null)?.velocity;
  const x = typeof velocity?.x === 'number' && Number.isFinite(velocity.x) ? Math.abs(velocity.x) : 0;
  const y = typeof velocity?.y === 'number' && Number.isFinite(velocity.y) ? Math.abs(velocity.y) : 0;
  return Math.max(x, y);
}

export function rectNearBounds(rect: WorldRect, bounds: WorldRect, margin: number): boolean {
  return (
    rect.right + margin >= bounds.left
    && rect.left - margin <= bounds.right
    && rect.bottom + margin >= bounds.top
    && rect.top - margin <= bounds.bottom
  );
}

export function reachBuildMargin(speed: number): number {
  return REACH_BUILD_MARGIN_PX + speed * REACH_BUILD_LOOKAHEAD_S;
}

export function reachCheckMargin(speed: number): number {
  return REACH_CHECK_MARGIN_PX + speed * REACH_CHECK_LOOKAHEAD_S;
}

export function setsIntersect<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) return true;
  return false;
}
