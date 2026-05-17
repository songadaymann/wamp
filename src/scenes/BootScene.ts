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
  GOAL_MARKER_FLAG_SHEETS,
  createGoalMarkerFlagAnimations,
  loadGoalMarkerFlagSheets,
} from '../goals/markerFlags';
import {
  setBootProgress,
  setBootStatus,
  showBootSplash,
} from '../ui/appFeedback';
import {
  PVP_HEART_TEXTURE_KEY,
  PVP_HEART_TEXTURE_PATH,
} from './overworld/pvpHeartDisplay';
import { logBootPhase, startBootStallWatch } from '../main/bootDiagnostics';

type PendingBootAsset = {
  key: string;
  type: string;
  url: string;
};

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    showBootSplash('Loading assets...', 0);
    const avatarAtlasAssets = listPlayerAvatarAtlasAssets();
    const assetGroupCount =
      TILESETS.length +
      BACKGROUND_GROUPS.reduce((total, group) => total + group.layers.length, 0) +
      GAME_OBJECTS.length +
      BLOCK_SWITCH_ACTIVE_TEXTURES.length +
      SWORDSMAN_AI_EXTRA_SPRITESHEETS.length +
      GHOST_EXTRA_SPRITESHEETS.length +
      avatarAtlasAssets.length +
      ROCKY_ROADS_FX_SPRITESHEETS.length +
      GOAL_MARKER_FLAG_SHEETS.length +
      3;
    let lastProgress = 0;
    const pendingAssets = new Map<string, PendingBootAsset>();
    const trackAsset = (type: string, key: string, url: string) => {
      pendingAssets.set(`${type}:${key}`, { key, type, url });
    };
    const clearTrackedAsset = (key: unknown, type: unknown) => {
      if (typeof key !== 'string') {
        return;
      }

      if (typeof type === 'string') {
        pendingAssets.delete(`${type}:${key}`);
      }

      for (const [assetId, asset] of pendingAssets) {
        if (asset.key === key) {
          pendingAssets.delete(assetId);
        }
      }
    };
    const getPendingAssetDetails = () => ({
      progressPercent: Math.round(lastProgress * 100),
      assetGroupCount,
      pendingAssetCount: pendingAssets.size,
      pendingAssets: Array.from(pendingAssets.values()).slice(0, 12),
    });
    const cancelAssetStallWatch = startBootStallWatch('asset preload', 15000, () => ({
      ...getPendingAssetDetails(),
    }));
    logBootPhase('boot-scene:preload-start', { assetGroupCount });

    this.load.once('complete', () => {
      cancelAssetStallWatch();
      logBootPhase('boot-scene:assets-complete', { assetGroupCount });
    });

    this.load.on('loaderror', (file: { key?: unknown; type?: unknown; url?: unknown }) => {
      clearTrackedAsset(file.key, file.type);
      logBootPhase(
        'boot-scene:asset-error',
        {
          key: typeof file.key === 'string' ? file.key : null,
          type: typeof file.type === 'string' ? file.type : null,
          url: typeof file.url === 'string' ? file.url : null,
        },
        { level: 'warn' }
      );
    });
    this.load.on('filecomplete', (key: unknown, type: unknown) => {
      clearTrackedAsset(key, type);
    });

    // Load all tilesets as images (Phaser tilemap system handles slicing)
    for (const ts of TILESETS) {
      trackAsset('image', ts.key, ts.path);
      this.load.image(ts.key, ts.path);
    }

    // Load all background parallax layers
    for (const group of BACKGROUND_GROUPS) {
      for (const layer of group.layers) {
        trackAsset('image', layer.key, layer.path);
        this.load.image(layer.key, layer.path);
      }
    }

    // Load game object spritesheets
    for (const obj of GAME_OBJECTS) {
      trackAsset('spritesheet', obj.id, obj.path);
      this.load.spritesheet(obj.id, obj.path, {
        frameWidth: obj.frameWidth,
        frameHeight: obj.frameHeight,
      });
    }

    for (const texture of BLOCK_SWITCH_ACTIVE_TEXTURES) {
      trackAsset('image', texture.key, texture.path);
      this.load.image(texture.key, texture.path);
    }

    trackAsset('spritesheet', 'cannon_bullet', 'assets/enemies/bullet.png');
    this.load.spritesheet('cannon_bullet', 'assets/enemies/bullet.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    trackAsset('image', 'room_comment_icon', 'assets/ui/comment-indicator.png');
    this.load.image('room_comment_icon', 'assets/ui/comment-indicator.png');
    trackAsset('image', PVP_HEART_TEXTURE_KEY, PVP_HEART_TEXTURE_PATH);
    this.load.image(PVP_HEART_TEXTURE_KEY, PVP_HEART_TEXTURE_PATH);

    for (const sheet of SWORDSMAN_AI_EXTRA_SPRITESHEETS) {
      trackAsset('spritesheet', sheet.key, sheet.path);
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }

    for (const sheet of GHOST_EXTRA_SPRITESHEETS) {
      trackAsset('spritesheet', sheet.key, sheet.path);
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }

    for (const atlas of avatarAtlasAssets) {
      trackAsset('atlas', atlas.key, `${atlas.texturePath} + ${atlas.atlasPath}`);
      this.load.atlas(atlas.key, atlas.texturePath, atlas.atlasPath);
    }

    for (const effectSheet of ROCKY_ROADS_FX_SPRITESHEETS) {
      trackAsset('spritesheet', effectSheet.key, effectSheet.path);
      this.load.spritesheet(effectSheet.key, effectSheet.path, {
        frameWidth: effectSheet.frameWidth,
        frameHeight: effectSheet.frameHeight,
      });
    }

    for (const sheet of GOAL_MARKER_FLAG_SHEETS) {
      trackAsset('spritesheet', sheet.textureKey, sheet.path);
    }
    loadGoalMarkerFlagSheets(this);

    // Loading progress
    this.load.on('progress', (value: number) => {
      lastProgress = value;
      setBootProgress(value);
      setBootStatus(`Loading assets... ${Math.round(value * 100)}%`);
    });
  }

  create(): void {
    logBootPhase('boot-scene:create-start');
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
    logBootPhase('boot-scene:handoff-overworld');
    this.scene.start('OverworldPlayScene');
  }
}
