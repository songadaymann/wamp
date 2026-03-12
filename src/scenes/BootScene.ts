import Phaser from 'phaser';
import { TILESETS, BACKGROUND_GROUPS, GAME_OBJECTS, getObjectAnimationFrames } from '../config';
import {
  DEFAULT_PLAYER_ATLAS_ASSETS,
  DEFAULT_PLAYER_ANIMATIONS,
  DEFAULT_PLAYER_FX_ANIMATIONS,
} from '../player/defaultPlayer';
import {
  ROCKY_ROADS_FX_ANIMATIONS,
  ROCKY_ROADS_FX_SPRITESHEETS,
} from '../fx/manifest';
import {
  createGoalMarkerFlagAnimations,
  loadGoalMarkerFlagSheets,
} from '../goals/markerFlags';
import {
  setBootProgress,
  setBootStatus,
  showBootSplash,
} from '../ui/appFeedback';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    showBootSplash('Loading assets...', 0);

    // Load all tilesets as images (Phaser tilemap system handles slicing)
    for (const ts of TILESETS) {
      this.load.image(ts.key, ts.path);
    }

    // Load all background parallax layers
    for (const group of BACKGROUND_GROUPS) {
      for (const layer of group.layers) {
        this.load.image(layer.key, layer.path);
      }
    }

    // Load game object spritesheets
    for (const obj of GAME_OBJECTS) {
      this.load.spritesheet(obj.id, obj.path, {
        frameWidth: obj.frameWidth,
        frameHeight: obj.frameHeight,
      });
    }

    this.load.spritesheet('cannon_bullet', 'assets/enemies/bullet.png', {
      frameWidth: 16,
      frameHeight: 16,
    });

    for (const atlas of DEFAULT_PLAYER_ATLAS_ASSETS) {
      this.load.atlas(atlas.key, atlas.texturePath, atlas.atlasPath);
    }

    for (const effectSheet of ROCKY_ROADS_FX_SPRITESHEETS) {
      this.load.spritesheet(effectSheet.key, effectSheet.path, {
        frameWidth: effectSheet.frameWidth,
        frameHeight: effectSheet.frameHeight,
      });
    }

    loadGoalMarkerFlagSheets(this);

    // Loading progress
    this.load.on('progress', (value: number) => {
      setBootProgress(value);
      setBootStatus(`Loading assets... ${Math.round(value * 100)}%`);
    });
  }

  create(): void {
    this.input.addPointer(4);

    // Create animations for game objects with multiple frames
    for (const obj of GAME_OBJECTS) {
      if (obj.frameCount > 1 && obj.fps > 0) {
        this.anims.create({
          key: `${obj.id}_anim`,
          frames: getObjectAnimationFrames(obj).map((frame) => ({
            key: obj.id,
            frame,
          })),
          frameRate: obj.fps,
          repeat: -1,
        });
      }
    }

    for (const animation of DEFAULT_PLAYER_ANIMATIONS) {
      if (this.anims.exists(animation.key)) {
        continue;
      }

      this.anims.create({
        key: animation.key,
        frames: animation.frameNames.map((frameName) => ({
          key: animation.atlasKey,
          frame: frameName,
        })),
        frameRate: animation.frameRate,
        repeat: animation.repeat,
      });
    }

    for (const animation of DEFAULT_PLAYER_FX_ANIMATIONS) {
      if (this.anims.exists(animation.key)) {
        continue;
      }

      this.anims.create({
        key: animation.key,
        frames: animation.frameNames.map((frameName) => ({
          key: animation.atlasKey,
          frame: frameName,
        })),
        frameRate: animation.frameRate,
        repeat: animation.repeat,
      });
    }

    for (const animation of ROCKY_ROADS_FX_ANIMATIONS) {
      if (this.anims.exists(animation.key)) {
        continue;
      }

      this.anims.create({
        key: animation.key,
        frames: this.anims.generateFrameNumbers(animation.spritesheetKey, {
          start: animation.startFrame,
          end: animation.endFrame,
        }),
        frameRate: animation.frameRate,
        repeat: animation.repeat,
      });
    }

    createGoalMarkerFlagAnimations(this);

    setBootProgress(1);
    setBootStatus('Loading world...');
    this.scene.start('OverworldPlayScene');
  }
}
