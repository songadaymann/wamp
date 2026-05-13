import Phaser from 'phaser';

export const PVP_HEART_TEXTURE_KEY = 'pvp_heart_full';
export const PVP_HEART_TEXTURE_PATH = 'assets/ui/pvp-heart-full.png';

const HEART_SPACING_PX = 12;

export class PvpHeartDisplay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly icons: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(depth);
    this.container.setVisible(false);
  }

  setHearts(hearts: number): void {
    const nextCount = Math.max(0, Math.floor(hearts));
    while (this.icons.length < nextCount) {
      const icon = this.scene.add.image(0, 0, PVP_HEART_TEXTURE_KEY);
      icon.setOrigin(0.5);
      icon.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.container.add(icon);
      this.icons.push(icon);
    }

    while (this.icons.length > nextCount) {
      this.icons.pop()?.destroy();
    }

    const totalWidth = Math.max(0, (this.icons.length - 1) * HEART_SPACING_PX);
    this.icons.forEach((icon, index) => {
      icon.setPosition(index * HEART_SPACING_PX - totalWidth * 0.5, 0);
    });
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  getGameObject(): Phaser.GameObjects.GameObject {
    return this.container;
  }

  destroy(): void {
    this.container.destroy();
  }
}
