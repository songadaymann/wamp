import type Phaser from 'phaser';
import type { LoadedRoomObject } from './model';
import type { ArcadeObjectBody } from './bodies';
import type { RoomCoordinates } from '../../../persistence/roomModel';

export const JUMP_FEATHER_RESPAWN_MS = 3_000;

export class LiveObjectJumpFeatherController {
  constructor(private readonly host: {
    scene: Phaser.Scene;
    getCurrentTime: () => number;
    grantAirJump: () => boolean;
    showTransientStatus: (message: string) => void;
    playPickupFx: (object: LoadedRoomObject, coordinates: RoomCoordinates) => void;
  }) {}

  addInteraction(object: LoadedRoomObject, player: Phaser.GameObjects.GameObject, coordinates: RoomCoordinates): void {
    object.interactions.push(this.host.scene.physics.add.overlap(player, object.sprite, () => {
      if (!object.sprite.active || !object.sprite.visible ||
          this.host.getCurrentTime() < object.runtime.cooldownUntil || !this.host.grantAirJump()) return;
      object.runtime.cooldownUntil = this.host.getCurrentTime() + JUMP_FEATHER_RESPAWN_MS;
      object.sprite.setVisible(false);
      if (object.sprite.body) (object.sprite.body as ArcadeObjectBody).enable = false;
      this.host.playPickupFx(object, coordinates);
      this.host.showTransientStatus('Extra jump ready! Press Jump in midair.');
    }));
  }

  update(object: LoadedRoomObject): void {
    const available = this.host.getCurrentTime() >= object.runtime.cooldownUntil;
    object.sprite.setVisible(available);
    if (object.sprite.body) (object.sprite.body as ArcadeObjectBody).enable = available;
    // Alpha pulses without moving the overlap body away from the authored position.
    object.sprite.setAlpha(0.82 + Math.sin(this.host.getCurrentTime() / 240) * 0.18);
  }
}
