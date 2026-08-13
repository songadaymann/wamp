import Phaser from 'phaser';
import {
  getObjectById,
  getObjectDefaultFrame,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getPlacedObjectLayer,
  type PlacedObject,
} from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { ensureCustomSpriteTexture } from '../../customSprites/registry';
import { createGoalMarkerFlagSprite } from '../../goals/markerFlags';
import type { RoomGoal } from '../../goals/roomGoals';
import type { RoomSpawnPoint } from '../../persistence/roomRepository';
import { buildRoomGoalMarkerDescriptors } from './goalDocument';

export interface EditorDocumentPresentationState {
  origin: { x: number; y: number };
  placedObjects: readonly PlacedObject[];
  spawnPoint: RoomSpawnPoint | null;
  goal: RoomGoal | null;
}

export class EditorDocumentPresentationController {
  private objectSprites: Phaser.GameObjects.Sprite[] = [];
  private spawnMarkerSprite: Phaser.GameObjects.Sprite | null = null;
  private goalMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private goalMarkerLabels: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly syncBackgroundCameraIgnores: () => void,
  ) {}

  get placedObjectSprites(): Phaser.GameObjects.Sprite[] {
    return this.objectSprites;
  }

  get currentSpawnMarkerSprite(): Phaser.GameObjects.Sprite | null {
    return this.spawnMarkerSprite;
  }

  get currentGoalMarkerSprites(): Phaser.GameObjects.Sprite[] {
    return this.goalMarkerSprites;
  }

  get currentGoalMarkerLabels(): Phaser.GameObjects.Text[] {
    return this.goalMarkerLabels;
  }

  reset(): void {
    this.destroyObjectSprites();
    this.destroyGoalMarkers();
    this.spawnMarkerSprite?.destroy();
    this.spawnMarkerSprite = null;
  }

  rebuild(state: EditorDocumentPresentationState): void {
    this.destroyObjectSprites();
    for (const placed of state.placedObjects) {
      const objectConfig = getEditorObjectConfigById(placed.id);
      if (!objectConfig) {
        continue;
      }

      const worldX = state.origin.x + placed.x;
      const worldY = state.origin.y + placed.y;
      ensureCustomSpriteTexture(this.scene, objectConfig);
      const displayOffset = getObjectDisplayOffset(objectConfig);
      const sprite = this.scene.add.sprite(
        worldX + displayOffset.x,
        worldY + displayOffset.y,
        objectConfig.id,
        0,
      );
      sprite.setDepth(getPlacedObjectEditorDepth(placed));
      sprite.setOrigin(0.5, 0.5);
      sprite.setScale(getObjectDisplayScale(objectConfig));
      if (objectConfig.frameCount > 1 && objectConfig.fps > 0) {
        const animKey = `${objectConfig.id}_anim`;
        if (this.scene.anims.exists(animKey)) {
          sprite.play(animKey);
        }
      } else {
        sprite.setFrame(getObjectDefaultFrame(objectConfig));
      }
      if (
        placed.id === 'door_metal' ||
        placed.id === 'trapdoor_metal' ||
        placed.id === 'blast_door'
      ) {
        sprite.setTint(0xb8c4d8);
      }
      applyPlacedObjectFacing(sprite, objectConfig, placed);
      this.objectSprites.push(sprite);
    }

    this.spawnMarkerSprite?.destroy();
    this.spawnMarkerSprite = null;
    if (state.spawnPoint) {
      this.spawnMarkerSprite = this.scene.add.sprite(
        state.origin.x + state.spawnPoint.x,
        state.origin.y + state.spawnPoint.y,
        'spawn_point',
        0,
      );
      this.spawnMarkerSprite.setOrigin(0.5, 1);
      this.spawnMarkerSprite.setDepth(26);
      this.spawnMarkerSprite.setAlpha(0.92);
    }

    this.redrawGoalMarkers(state.origin, state.goal);
  }

  private destroyObjectSprites(): void {
    for (const sprite of this.objectSprites) {
      sprite.destroy();
    }
    this.objectSprites = [];
  }

  private destroyGoalMarkers(): void {
    for (const sprite of this.goalMarkerSprites) {
      sprite.destroy();
    }
    this.goalMarkerSprites = [];
    for (const label of this.goalMarkerLabels) {
      label.destroy();
    }
    this.goalMarkerLabels = [];
  }

  private redrawGoalMarkers(origin: { x: number; y: number }, goal: RoomGoal | null): void {
    this.destroyGoalMarkers();
    if (!goal) {
      this.syncBackgroundCameraIgnores();
      return;
    }

    for (const marker of buildRoomGoalMarkerDescriptors(goal)) {
      const sprite = createGoalMarkerFlagSprite(
        this.scene,
        marker.variant,
        origin.x + marker.point.x,
        origin.y + marker.point.y + 2,
        97,
      );
      this.goalMarkerSprites.push(sprite);

      if (marker.label) {
        const label = this.scene.add.text(
          origin.x + marker.point.x,
          origin.y + marker.point.y - 28,
          marker.label,
          {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: marker.textColor,
            stroke: '#050505',
            strokeThickness: 4,
          },
        );
        label.setOrigin(0.5, 1);
        label.setDepth(98);
        this.goalMarkerLabels.push(label);
      }
    }

    this.syncBackgroundCameraIgnores();
  }
}

export function getPlacedObjectEditorDepth(placed: PlacedObject): number {
  switch (getPlacedObjectLayer(placed)) {
    case 'background':
      return 5;
    case 'foreground':
      return 60;
    case 'terrain':
    default:
      return 25;
  }
}

function applyPlacedObjectFacing(
  sprite: Phaser.GameObjects.Sprite,
  objectConfig: ReturnType<typeof getObjectById>,
  placed: PlacedObject,
): void {
  if (!objectConfig?.facingDirection || !placed.facing) {
    sprite.setFlipX(false);
    return;
  }

  sprite.setFlipX(objectConfig.facingDirection !== placed.facing);
}
