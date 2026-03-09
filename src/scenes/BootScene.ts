import Phaser from 'phaser';
import { TILESETS, BACKGROUND_GROUPS, GAME_OBJECTS } from '../config';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
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

    // Loading progress
    this.load.on('progress', (value: number) => {
      console.log(`Loading: ${Math.round(value * 100)}%`);
    });
  }

  create(): void {
    // Create animations for game objects with multiple frames
    for (const obj of GAME_OBJECTS) {
      if (obj.frameCount > 1 && obj.fps > 0) {
        this.anims.create({
          key: `${obj.id}_anim`,
          frames: this.anims.generateFrameNumbers(obj.id, {
            start: 0,
            end: obj.frameCount - 1,
          }),
          frameRate: obj.fps,
          repeat: -1,
        });
      }
    }

    console.log('Assets loaded, starting world...');
    this.scene.start('OverworldPlayScene');
  }
}
