import Phaser from 'phaser';
import {
  TILESETS,
  BACKGROUND_GROUPS,
  GAME_OBJECTS,
  BLOCK_SWITCH_ACTIVE_TEXTURES,
  getObjectAnimationFrames,
} from '../config';
import {
  DEFAULT_PLAYER_FX_ANIMATIONS,
} from '../player/defaultPlayer';
import {
  listPlayerAvatarAnimations,
  listPlayerAvatarAtlasAssets,
} from '../player/avatar/loader';
import {
  ROCKY_ROADS_FX_ANIMATIONS,
  ROCKY_ROADS_FX_SPRITESHEETS,
} from '../fx/manifest';
import {
  SWORDSMAN_AI_ANIMATIONS,
  SWORDSMAN_AI_EXTRA_SPRITESHEETS,
} from '../enemies/swordsmanAi';
import {
  GHOST_ANIMATIONS,
  GHOST_EXTRA_SPRITESHEETS,
} from '../enemies/ghost';
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

    for (const texture of BLOCK_SWITCH_ACTIVE_TEXTURES) {
      this.load.image(texture.key, texture.path);
    }

    this.load.spritesheet('cannon_bullet', 'assets/enemies/bullet.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.image('room_comment_icon', 'assets/ui/comment-indicator.png');

    for (const sheet of SWORDSMAN_AI_EXTRA_SPRITESHEETS) {
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }

    for (const sheet of GHOST_EXTRA_SPRITESHEETS) {
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }

    for (const atlas of listPlayerAvatarAtlasAssets()) {
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

    if (!this.anims.exists('brick_box_break_anim')) {
      this.anims.create({
        key: 'brick_box_break_anim',
        frames: [5, 4, 3, 2, 1, 0].map((frame) => ({
          key: 'brick_box',
          frame,
        })),
        frameRate: 18,
        repeat: 0,
      });
    }

    for (const animation of SWORDSMAN_AI_ANIMATIONS) {
      if (this.anims.exists(animation.key)) {
        continue;
      }

      this.anims.create({
        key: animation.key,
        frames: animation.frames.map((frame) => ({
          key: animation.spritesheetKey,
          frame,
        })),
        frameRate: animation.frameRate,
        repeat: animation.repeat,
      });
    }

    for (const animation of GHOST_ANIMATIONS) {
      if (this.anims.exists(animation.key)) {
        continue;
      }

      this.anims.create({
        key: animation.key,
        frames: animation.frames.map((frame) => ({
          key: animation.spritesheetKey,
          frame,
        })),
        frameRate: animation.frameRate,
        repeat: animation.repeat,
      });
    }

    for (const animation of listPlayerAvatarAnimations()) {
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
