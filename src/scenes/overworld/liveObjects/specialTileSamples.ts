import type Phaser from 'phaser';
import { getBodyVelocityAlongVector, getGravityVector, type PlayerGravityDirection, type SpecialTilePlayerEnvironment } from '../specialTiles';

interface BodySample {
  conveyorX: -1 | 0 | 1;
  left: number; right: number; top: number; bottom: number; centerX: number; centerY: number;
  gravityDirection: PlayerGravityDirection;
}

/** Reuse the current scan, but recheck contact if a behavior moved or rotated the body. */
export class SpecialTileBodySamples {
  private readonly samples = new WeakMap<Phaser.Physics.Arcade.Body, BodySample>();

  record(body: Phaser.Physics.Arcade.Body, environment: Readonly<SpecialTilePlayerEnvironment>): void {
    let sample = this.samples.get(body);
    if (!sample) {
      sample = { conveyorX: environment.conveyorX, left: body.left, right: body.right, top: body.top, bottom: body.bottom,
        gravityDirection: environment.gravityDirection, centerX: body.center.x, centerY: body.center.y };
      this.samples.set(body, sample);
      return;
    }
    sample.conveyorX = environment.conveyorX;
    sample.left = body.left; sample.right = body.right; sample.top = body.top; sample.bottom = body.bottom;
    sample.gravityDirection = environment.gravityDirection;
    sample.centerX = body.center.x; sample.centerY = body.center.y;
  }

  conveyor(body: Phaser.Physics.Arcade.Body, gravityDirection: PlayerGravityDirection): -1 | 0 | 1 | null {
    const sample = this.samples.get(body);
    if (!sample || sample.gravityDirection !== gravityDirection || sample.left !== body.left
      || sample.right !== body.right || sample.top !== body.top || sample.bottom !== body.bottom
      || sample.centerX !== body.center.x || sample.centerY !== body.center.y) return null;
    return sample.conveyorX;
  }

  applyConveyor(body: Phaser.Physics.Arcade.Body, direction: PlayerGravityDirection, speed: number,
    fallback: { getConveyorDirectionForBody: (body: Phaser.Physics.Arcade.Body, direction: PlayerGravityDirection) => -1 | 0 | 1 }): void {
    if (getBodyVelocityAlongVector(body, getGravityVector(direction)) < -20) return;
    const conveyor = this.conveyor(body, direction) ?? fallback.getConveyorDirectionForBody(body, direction);
    if (conveyor !== 0) body.setVelocityX(body.velocity.x + conveyor * speed);
  }

  invalidate(body: Phaser.Physics.Arcade.Body): void { this.samples.delete(body); }
}
