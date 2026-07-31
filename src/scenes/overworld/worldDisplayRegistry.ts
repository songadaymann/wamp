import Phaser from 'phaser';

type WorldDisplayRegistryOptions = {
  scene: Phaser.Scene;
  mainCamera: Phaser.Cameras.Scene2D.Camera;
  backdropCamera: Phaser.Cameras.Scene2D.Camera;
  backdropLayer: Phaser.GameObjects.Layer;
  worldLayer: Phaser.GameObjects.Layer;
};

export class WorldDisplayRegistry {
  private destroyed = false;

  private readonly handleAddedToScene = (
    gameObject: Phaser.GameObjects.GameObject,
  ): void => {
    this.registerWorld(gameObject);
  };

  constructor(private readonly options: WorldDisplayRegistryOptions) {
    const {
      scene,
      mainCamera,
      backdropCamera,
      backdropLayer,
      worldLayer,
    } = options;

    mainCamera.transparent = true;
    mainCamera.ignore(backdropLayer);
    backdropCamera.ignore(worldLayer);
    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.handleAddedToScene);

    const existingObjects = [...scene.sys.displayList.getChildren()];
    for (const gameObject of existingObjects) {
      this.registerWorld(gameObject);
    }
  }

  registerWorld(
    gameObjectOrObjects:
      | Phaser.GameObjects.GameObject
      | readonly Phaser.GameObjects.GameObject[],
  ): void {
    if (this.destroyed) return;
    const gameObjects = Array.isArray(gameObjectOrObjects)
      ? gameObjectOrObjects
      : [gameObjectOrObjects];
    const { backdropLayer, worldLayer } = this.options;
    for (const gameObject of gameObjects) {
      if (
        gameObject === backdropLayer
        || gameObject === worldLayer
        || gameObject instanceof Phaser.GameObjects.Layer
        || gameObject.parentContainer
        || gameObject.displayList === backdropLayer
        || gameObject.displayList === worldLayer
      ) {
        continue;
      }
      worldLayer.add(gameObject);
    }
  }

  registerBackdrop(
    gameObjectOrObjects:
      | Phaser.GameObjects.GameObject
      | readonly Phaser.GameObjects.GameObject[],
  ): void {
    if (this.destroyed) return;
    const gameObjects = Array.isArray(gameObjectOrObjects)
      ? gameObjectOrObjects
      : [gameObjectOrObjects];
    const { backdropLayer } = this.options;
    for (const gameObject of gameObjects) {
      if (gameObject !== backdropLayer && gameObject.displayList !== backdropLayer) {
        backdropLayer.add(gameObject);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.scene.events.off(
      Phaser.Scenes.Events.ADDED_TO_SCENE,
      this.handleAddedToScene,
    );
  }
}
