import Phaser from 'phaser';

export type ArcadeObjectBody = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;

export function isDynamicArcadeBody(body: ArcadeObjectBody | null): body is Phaser.Physics.Arcade.Body {
  return Boolean(body && 'velocity' in body);
}

export function getArcadeBodyBounds(body: ArcadeObjectBody): Phaser.Geom.Rectangle {
  return new Phaser.Geom.Rectangle(body.left, body.top, body.width, body.height);
}

export function arcadeBodiesOverlap(first: ArcadeObjectBody, second: ArcadeObjectBody): boolean {
  return Phaser.Geom.Intersects.RectangleToRectangle(
    getArcadeBodyBounds(first),
    getArcadeBodyBounds(second),
  );
}

export function arcadeBodiesTouchOrOverlap(
  first: ArcadeObjectBody,
  second: ArcadeObjectBody,
  tolerancePx = 1,
): boolean {
  const firstBounds = getArcadeBodyBounds(first);
  const secondBounds = getArcadeBodyBounds(second);
  return (
    firstBounds.right + tolerancePx >= secondBounds.left
    && firstBounds.left - tolerancePx <= secondBounds.right
    && firstBounds.bottom + tolerancePx >= secondBounds.top
    && firstBounds.top - tolerancePx <= secondBounds.bottom
  );
}
