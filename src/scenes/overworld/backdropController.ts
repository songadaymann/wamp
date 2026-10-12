import type Phaser from 'phaser';
import {
  createStarfieldTileSprite,
  getStarfieldLayerConfig,
  type StarfieldLayerConfig,
} from '../../visuals/starfield';

interface OverworldBackdropControllerOptions {
  scene: Phaser.Scene;
  updateWorldBackgrounds: (camera: Phaser.Cameras.Scene2D.Camera) => void;
}

interface OverworldBackdropControllerDependencies {
  createStarfieldTileSprite: typeof createStarfieldTileSprite;
  getStarfieldLayerConfig: (index: number) => StarfieldLayerConfig;
}

export interface OverworldBackdropDisplayHealth {
  mainCamera: {
    id: number;
    visible: boolean;
    alpha: number;
  };
  backdropCamera: {
    id: number;
    visible: boolean;
    alpha: number;
  } | null;
  backdropLayer: Record<string, unknown> | null;
}

const DEFAULT_DEPENDENCIES: OverworldBackdropControllerDependencies = {
  createStarfieldTileSprite,
  getStarfieldLayerConfig,
};

/**
 * The starfield is drawn by its own unzoomed camera behind the main one. That camera renders
 * only the backdrop layer, so world objects need no registration to stay off it (F068); the
 * main camera ignores the backdrop layer.
 */
export class OverworldBackdropController {
  private readonly dependencies: OverworldBackdropControllerDependencies;
  private starfieldSprites: Phaser.GameObjects.TileSprite[] = [];
  private backdropCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private backdropDisplayLayer: Phaser.GameObjects.Layer | null = null;
  private restoreVisibleChildren: (() => void) | null = null;

  constructor(
    private readonly options: OverworldBackdropControllerOptions,
    dependencies: Partial<OverworldBackdropControllerDependencies> = {},
  ) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  }

  create(): void {
    const { scene } = this.options;
    this.backdropDisplayLayer = scene.add.layer().setDepth(-1000);
    this.starfieldSprites = [0, 1].map((index) => {
      const config = this.dependencies.getStarfieldLayerConfig(index);
      return this.dependencies.createStarfieldTileSprite(scene, {
        x: 0,
        y: 0,
        width: scene.scale.width,
        height: scene.scale.height,
        depth: -80 + index,
        alpha: config.alpha,
      });
    });
    this.backdropDisplayLayer.add(this.starfieldSprites);
    this.ensureCamera();
    this.syncIgnores();
    this.resize();
    this.update();
  }

  update(): void {
    const motionCamera = this.options.scene.cameras.main;
    this.options.updateWorldBackgrounds(motionCamera);

    if (this.starfieldSprites.length === 0) {
      return;
    }

    for (let index = 0; index < this.starfieldSprites.length; index += 1) {
      const sprite = this.starfieldSprites[index];
      const config = this.dependencies.getStarfieldLayerConfig(index);
      sprite.tilePositionX = (motionCamera.scrollX * config.parallax) / config.tileScale;
      sprite.tilePositionY = (motionCamera.scrollY * config.parallax) / config.tileScale;
    }

    this.backdropCamera?.setScroll(0, 0);
  }

  resize(): void {
    const { width, height } = this.options.scene.scale;
    for (let index = 0; index < this.starfieldSprites.length; index += 1) {
      const sprite = this.starfieldSprites[index];
      const config = this.dependencies.getStarfieldLayerConfig(index);
      sprite.setPosition(0, 0);
      sprite.setSize(width, height);
      sprite.setTileScale(config.tileScale, config.tileScale);
    }
    this.backdropCamera?.setSize(width, height);
  }

  syncIgnores(): void {
    const mainCamera = this.options.scene.cameras.main;
    mainCamera.transparent = true;

    if (this.backdropDisplayLayer) {
      this.backdropDisplayLayer.setActive(true).setVisible(true).setAlpha(1);
      mainCamera.ignore(this.backdropDisplayLayer);
    }
  }

  reset(): void {
    this.beginReset();
    this.finishReset();
  }

  beginReset(): void {
    this.uninstallBackdropCameraFilter();
    const { cameras } = this.options.scene;
    if (this.backdropCamera && cameras.cameras.includes(this.backdropCamera)) {
      cameras.remove(this.backdropCamera, true);
    }
  }

  finishReset(): void {
    this.starfieldSprites = [];
    this.backdropDisplayLayer?.destroy();
    this.backdropDisplayLayer = null;
    this.backdropCamera = null;
  }

  destroy(): void {
    for (const sprite of this.starfieldSprites) {
      sprite.destroy();
    }
    this.starfieldSprites = [];
    this.backdropDisplayLayer?.destroy();
    this.backdropDisplayLayer = null;
    this.uninstallBackdropCameraFilter();

    const { cameras } = this.options.scene;
    if (this.backdropCamera && cameras.cameras.includes(this.backdropCamera)) {
      cameras.remove(this.backdropCamera, true);
    }
    this.backdropCamera = null;
  }

  isCameraActive(): boolean {
    return Boolean(this.backdropCamera);
  }

  getLayerCount(): number {
    return Number(Boolean(this.backdropDisplayLayer));
  }

  getDisplayHealth(): OverworldBackdropDisplayHealth {
    const mainCamera = this.options.scene.cameras.main;
    return {
      mainCamera: {
        id: mainCamera.id,
        visible: mainCamera.visible,
        alpha: mainCamera.alpha,
      },
      backdropCamera: this.backdropCamera
        ? {
            id: this.backdropCamera.id,
            visible: this.backdropCamera.visible,
            alpha: this.backdropCamera.alpha,
          }
        : null,
      backdropLayer: describeDisplayLayer(this.backdropDisplayLayer, this.backdropCamera),
    };
  }

  private ensureCamera(): void {
    const { cameras, scale } = this.options.scene;
    if (!this.backdropCamera) {
      this.backdropCamera = cameras.add(0, 0, scale.width, scale.height);
      this.backdropCamera.setScroll(0, 0);
      this.backdropCamera.setRoundPixels(true);

      const backdropIndex = cameras.cameras.indexOf(this.backdropCamera);
      if (backdropIndex > 0) {
        cameras.cameras.splice(backdropIndex, 1);
        cameras.cameras.unshift(this.backdropCamera);
      }
      this.installBackdropCameraFilter();
      return;
    }

    this.backdropCamera.setSize(scale.width, scale.height);
  }

  /** The backdrop camera renders the backdrop layer and nothing else. */
  private installBackdropCameraFilter(): void {
    if (this.restoreVisibleChildren) return;
    const { cameras } = this.options.scene;
    const getVisibleChildren = cameras.getVisibleChildren;
    const backdropOnly: Phaser.GameObjects.GameObject[] = [];
    cameras.getVisibleChildren = (children, camera) => {
      if (camera !== this.backdropCamera) return getVisibleChildren.call(cameras, children, camera);
      backdropOnly.length = 0;
      const layer = this.backdropDisplayLayer;
      if (layer?.displayList && layer.willRender(camera)) {
        backdropOnly.push(layer as unknown as Phaser.GameObjects.GameObject);
      }
      return backdropOnly;
    };
    this.restoreVisibleChildren = () => {
      cameras.getVisibleChildren = getVisibleChildren;
    };
  }

  private uninstallBackdropCameraFilter(): void {
    this.restoreVisibleChildren?.();
    this.restoreVisibleChildren = null;
  }
}

function describeDisplayLayer(
  layer: Phaser.GameObjects.Layer | null,
  camera: Phaser.Cameras.Scene2D.Camera | null,
): Record<string, unknown> | null {
  if (!layer) return null;
  return {
    active: layer.active,
    visible: layer.visible,
    alpha: layer.alpha,
    renderFlags: layer.renderFlags,
    cameraFilter: layer.cameraFilter,
    attachedToDisplayList: Boolean(layer.displayList),
    childCount: layer.list.length,
    visibleToCamera: camera ? layer.willRender(camera) : null,
  };
}
