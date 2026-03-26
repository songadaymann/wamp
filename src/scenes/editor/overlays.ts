import Phaser from 'phaser';
import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  getObjectById,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { RETRO_COLORS } from '../../visuals/starfield';

interface EditorOverlayHost {
  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer>;
  getPlacedObjects(): PlacedObject[];
  isClipboardPastePreviewActive(): boolean;
}

export class EditorOverlayController {
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;
  private borderGraphics: Phaser.GameObjects.Graphics | null = null;
  private layerGuideGraphics: Phaser.GameObjects.Graphics | null = null;
  private pressurePlateGraphics: Phaser.GameObjects.Graphics | null = null;
  private containerGraphics: Phaser.GameObjects.Graphics | null = null;
  private layerIndicatorText: Phaser.GameObjects.Text | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorOverlayHost,
  ) {}

  get gridOverlay(): Phaser.GameObjects.Graphics | null {
    return this.gridGraphics;
  }

  get borderOverlay(): Phaser.GameObjects.Graphics | null {
    return this.borderGraphics;
  }

  get layerGuideOverlay(): Phaser.GameObjects.Graphics | null {
    return this.layerGuideGraphics;
  }

  createOverlays(): void {
    this.createRoomBorder();
    this.createGrid();
    this.createLayerGuideOverlay();
    this.createPressurePlateOverlay();
    this.createContainerOverlay();
    this.createLayerIndicator();
  }

  reset(): void {
    this.layerIndicatorText?.destroy();
    this.layerIndicatorText = null;
    this.layerGuideGraphics?.destroy();
    this.layerGuideGraphics = null;
    this.pressurePlateGraphics?.destroy();
    this.pressurePlateGraphics = null;
    this.containerGraphics?.destroy();
    this.containerGraphics = null;
    this.gridGraphics?.destroy();
    this.gridGraphics = null;
    this.borderGraphics?.destroy();
    this.borderGraphics = null;
  }

  updatePressurePlateOverlay(
    render: (graphics: Phaser.GameObjects.Graphics | null) => void,
  ): void {
    render(this.pressurePlateGraphics);
  }

  updateContainerOverlay(
    render: (graphics: Phaser.GameObjects.Graphics | null) => void,
  ): void {
    render(this.containerGraphics);
  }

  updateLayerGuideOverlay(): void {
    this.layerGuideGraphics?.clear();
    if (!this.layerGuideGraphics || editorState.isPlaying || !editorState.showLayerGuides) {
      return;
    }

    for (const layerName of LAYER_NAMES) {
      const occupiedCells = this.collectLayerGuideCells(layerName);
      if (occupiedCells.size === 0) {
        continue;
      }

      this.layerGuideGraphics.fillStyle(this.getLayerGuideColor(layerName), 0.72);
      for (const key of occupiedCells) {
        const [xText, yText] = key.split(':');
        const tileX = Number.parseInt(xText, 10);
        const tileY = Number.parseInt(yText, 10);
        this.layerGuideGraphics.fillCircle(
          tileX * TILE_SIZE + TILE_SIZE * 0.5,
          tileY * TILE_SIZE + TILE_SIZE * 0.5,
          2.5,
        );
      }
    }
  }

  updateLayerIndicator(): void {
    if (!this.layerIndicatorText) {
      return;
    }

    const layerLabel =
      editorState.activeLayer === 'terrain'
        ? 'Gameplay'
        : editorState.activeLayer === 'background'
          ? 'Back'
          : 'Front';
    const layerColor =
      editorState.activeLayer === 'terrain'
        ? '#347433'
        : editorState.activeLayer === 'background'
          ? '#2f6b7f'
          : '#ff6f3c';
    const modeLabel = editorState.paletteMode === 'objects' ? 'Objects' : 'Tiles';
    const toolLabel =
      editorState.activeTool === 'eraser'
        ? `Erase ${editorState.eraserBrushSize}x${editorState.eraserBrushSize}`
        : editorState.activeTool === 'rect'
          ? 'Rect'
          : editorState.activeTool === 'fill'
            ? 'Fill'
            : editorState.activeTool === 'copy'
              ? this.host.isClipboardPastePreviewActive()
                ? 'Paste'
                : 'Copy'
              : 'Draw';
    const flipLabels: string[] = [];
    if (editorState.paletteMode === 'tiles' && editorState.tileFlipX) {
      flipLabels.push('Flip H');
    }
    if (editorState.paletteMode === 'tiles' && editorState.tileFlipY) {
      flipLabels.push('Flip V');
    }
    const detailParts = [toolLabel, ...flipLabels];
    const text = `${modeLabel} -> ${layerLabel}\n${detailParts.join('  |  ')}`;
    if (this.layerIndicatorText.text !== text) {
      this.layerIndicatorText.setText(text);
    }

    this.layerIndicatorText.setBackgroundColor(`${layerColor}cc`);
    this.layerIndicatorText.setPosition(
      this.scene.scale.width - this.layerIndicatorText.width - 18,
      18,
    );
  }

  private createRoomBorder(): void {
    this.borderGraphics?.destroy();
    this.borderGraphics = this.scene.add.graphics();
    this.borderGraphics.lineStyle(2, RETRO_COLORS.published, 0.85);
    this.borderGraphics.strokeRect(0, 0, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    this.borderGraphics.setDepth(90);
  }

  private createGrid(): void {
    this.gridGraphics?.destroy();
    this.gridGraphics = this.scene.add.graphics();
    this.gridGraphics.lineStyle(1, RETRO_COLORS.grid, 0.12);

    for (let x = 0; x <= ROOM_WIDTH; x += 1) {
      this.gridGraphics.moveTo(x * TILE_SIZE, 0);
      this.gridGraphics.lineTo(x * TILE_SIZE, ROOM_PX_HEIGHT);
    }
    for (let y = 0; y <= ROOM_HEIGHT; y += 1) {
      this.gridGraphics.moveTo(0, y * TILE_SIZE);
      this.gridGraphics.lineTo(ROOM_PX_WIDTH, y * TILE_SIZE);
    }

    this.gridGraphics.strokePath();
    this.gridGraphics.setDepth(95);
  }

  private createLayerGuideOverlay(): void {
    this.layerGuideGraphics?.destroy();
    this.layerGuideGraphics = this.scene.add.graphics();
    this.layerGuideGraphics.setDepth(97);
  }

  private createPressurePlateOverlay(): void {
    this.pressurePlateGraphics?.destroy();
    this.pressurePlateGraphics = this.scene.add.graphics();
    this.pressurePlateGraphics.setDepth(99);
  }

  private createContainerOverlay(): void {
    this.containerGraphics?.destroy();
    this.containerGraphics = this.scene.add.graphics();
    this.containerGraphics.setDepth(98);
  }

  private createLayerIndicator(): void {
    this.layerIndicatorText?.destroy();
    this.layerIndicatorText = this.scene.add.text(0, 0, '', {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#f6f1de',
      backgroundColor: '#121109cc',
      padding: {
        x: 12,
        y: 7,
      },
    });
    this.layerIndicatorText.setDepth(130);
    this.layerIndicatorText.setScrollFactor(0);
    this.updateLayerIndicator();
  }

  private collectLayerGuideCells(layerName: LayerName): Set<string> {
    const occupiedCells = new Set<string>();
    const layer = this.host.getLayers().get(layerName);
    if (layer) {
      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          if (layer.getTileAt(x, y)) {
            occupiedCells.add(this.getLayerGuideCellKey(x, y));
          }
        }
      }
    }

    for (const placedObject of this.host.getPlacedObjects()) {
      const objectConfig = getObjectById(placedObject.id);
      if (!objectConfig || getPlacedObjectLayer(placedObject) !== layerName) {
        continue;
      }

      const previewWidth = objectConfig.previewWidth ?? objectConfig.frameWidth;
      const previewHeight = objectConfig.previewHeight ?? objectConfig.frameHeight;
      const previewOffsetX = objectConfig.previewOffsetX ?? 0;
      const previewOffsetY = objectConfig.previewOffsetY ?? 0;
      const minTileX = Math.max(
        0,
        Math.floor((placedObject.x - objectConfig.frameWidth * 0.5 + previewOffsetX) / TILE_SIZE),
      );
      const maxTileX = Math.min(
        ROOM_WIDTH,
        Math.ceil((placedObject.x - objectConfig.frameWidth * 0.5 + previewOffsetX + previewWidth) / TILE_SIZE),
      );
      const minTileY = Math.max(
        0,
        Math.floor((placedObject.y - objectConfig.frameHeight * 0.5 + previewOffsetY) / TILE_SIZE),
      );
      const maxTileY = Math.min(
        ROOM_HEIGHT,
        Math.ceil((placedObject.y - objectConfig.frameHeight * 0.5 + previewOffsetY + previewHeight) / TILE_SIZE),
      );
      for (let tileY = minTileY; tileY < maxTileY; tileY += 1) {
        for (let tileX = minTileX; tileX < maxTileX; tileX += 1) {
          occupiedCells.add(this.getLayerGuideCellKey(tileX, tileY));
        }
      }
    }

    return occupiedCells;
  }

  private getLayerGuideCellKey(x: number, y: number): string {
    return `${x}:${y}`;
  }

  private getLayerGuideColor(layerName: LayerName): number {
    switch (layerName) {
      case 'background':
        return 0x2f6b7f;
      case 'foreground':
        return 0xff6f3c;
      case 'terrain':
      default:
        return 0x347433;
    }
  }
}
