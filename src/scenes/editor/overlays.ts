import { drawDeathMap } from './deathMapOverlay';
import type { DeathMapCell } from '../../insights/model';
import type { RoomCoordinates } from '../../persistence/roomModel';
import Phaser from 'phaser';
import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { RETRO_COLORS } from '../../visuals/starfield';
import { getEditorToolHudLabel } from './editorToolSelection';
import { drawDeadlyPitBoundary, drawEditorGrid } from './grid';

interface EditorOverlayHost {
  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer>;
  hasDeadlyPits?(): boolean;
  getPlacedObjects(): PlacedObject[];
  isClipboardPastePreviewActive(): boolean;
}

export class EditorOverlayController {
  private deathMapGraphics: Phaser.GameObjects.Graphics | null = null;
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

  setDeathMap(points: DeathMapCell[], coordinates: RoomCoordinates): void {
    this.deathMapGraphics ??= this.scene.add.graphics().setDepth(102);
    drawDeathMap(this.deathMapGraphics, points, cell => cell.x === coordinates.x && cell.y === coordinates.y ? { x: 0, y: 0 } : null);
    this.deathMapGraphics.setVisible(!editorState.isPlaying);
  }

  clearDeathMap(): void {
    this.deathMapGraphics?.clear();
  }

  reset(): void {
    this.deathMapGraphics?.destroy(); this.deathMapGraphics = null;
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

  clearObjectInspectorOverlays(): void {
    this.pressurePlateGraphics?.clear();
    this.containerGraphics?.clear();
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

      for (const key of occupiedCells) {
        const [xText, yText] = key.split(':');
        const tileX = Number.parseInt(xText, 10);
        const tileY = Number.parseInt(yText, 10);
        this.drawLayerGuideCorner(layerName, tileX, tileY);
      }
    }
  }

  updateLayerIndicator(): void {
    this.deathMapGraphics?.setVisible(!editorState.isPlaying);
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
    const modeLabel = editorState.paletteMode === 'objects'
      ? 'Objects'
      : editorState.paletteMode === 'smart'
        ? 'Smart'
        : 'Tiles';
    const toolLabel = getEditorToolHudLabel(
      editorState.activeTool,
      this.host.isClipboardPastePreviewActive(),
    );
    const flipLabels: string[] = [];
    if (editorState.paletteMode === 'tiles' && editorState.tileFlipXMode === 'on') {
      flipLabels.push('Flip H');
    } else if (editorState.paletteMode === 'tiles' && editorState.tileFlipXMode === 'rand') {
      flipLabels.push('Rand H');
    }
    if (editorState.paletteMode === 'tiles' && editorState.tileFlipYMode === 'on') {
      flipLabels.push('Flip V');
    } else if (editorState.paletteMode === 'tiles' && editorState.tileFlipYMode === 'rand') {
      flipLabels.push('Rand V');
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

  redrawGrid(): void {
    if (!this.gridGraphics) return;
    this.gridGraphics.clear();
    drawEditorGrid(this.gridGraphics, 0, 0);
    if (this.host.hasDeadlyPits?.()) drawDeadlyPitBoundary(this.gridGraphics, 0, 0);
  }

  private createGrid(): void {
    this.gridGraphics?.destroy();
    this.gridGraphics = this.scene.add.graphics();
    this.redrawGrid();
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
      const objectConfig = getEditorObjectConfigById(placedObject.id);
      if (!objectConfig || getPlacedObjectLayer(placedObject) !== layerName) {
        continue;
      }

      const displayScale = getObjectDisplayScale(objectConfig);
      const displayOffset = getObjectDisplayOffset(objectConfig);
      const frameWidth = objectConfig.frameWidth * displayScale;
      const frameHeight = objectConfig.frameHeight * displayScale;
      const previewWidth = (objectConfig.previewWidth ?? objectConfig.frameWidth) * displayScale;
      const previewHeight = (objectConfig.previewHeight ?? objectConfig.frameHeight) * displayScale;
      const previewOffsetX = (objectConfig.previewOffsetX ?? 0) * displayScale;
      const previewOffsetY = (objectConfig.previewOffsetY ?? 0) * displayScale;
      const minTileX = Math.max(
        0,
        Math.floor((placedObject.x + displayOffset.x - frameWidth * 0.5 + previewOffsetX) / TILE_SIZE),
      );
      const maxTileX = Math.min(
        ROOM_WIDTH,
        Math.ceil((placedObject.x + displayOffset.x - frameWidth * 0.5 + previewOffsetX + previewWidth) / TILE_SIZE),
      );
      const minTileY = Math.max(
        0,
        Math.floor((placedObject.y + displayOffset.y - frameHeight * 0.5 + previewOffsetY) / TILE_SIZE),
      );
      const maxTileY = Math.min(
        ROOM_HEIGHT,
        Math.ceil((placedObject.y + displayOffset.y - frameHeight * 0.5 + previewOffsetY + previewHeight) / TILE_SIZE),
      );
      for (let tileY = minTileY; tileY < maxTileY; tileY += 1) {
        for (let tileX = minTileX; tileX < maxTileX; tileX += 1) {
          occupiedCells.add(this.getLayerGuideCellKey(tileX, tileY));
        }
      }
    }

    return occupiedCells;
  }

  private drawLayerGuideCorner(layerName: LayerName, tileX: number, tileY: number): void {
    const graphics = this.layerGuideGraphics;
    if (!graphics) {
      return;
    }
    const size = TILE_SIZE / 2;
    const edge = 0.5;
    const left = tileX * TILE_SIZE;
    const top = tileY * TILE_SIZE;
    const right = left + TILE_SIZE;
    const bottom = top + TILE_SIZE;
    const color = this.getLayerGuideColor(layerName);
    const outer = this.layerGuideCornerPoints(layerName, left, top, right, bottom, size, 0);
    const inner = this.layerGuideCornerPoints(layerName, left, top, right, bottom, size, edge);
    graphics.fillStyle(color, 0.92);
    graphics.fillTriangle(outer[0], outer[1], outer[2], outer[3], outer[4], outer[5]);
    graphics.fillStyle(0x000000, 0.75);
    graphics.fillTriangle(outer[0], outer[1], outer[2], outer[3], outer[4], outer[5]);
    graphics.fillStyle(color, 1);
    graphics.fillTriangle(inner[0], inner[1], inner[2], inner[3], inner[4], inner[5]);
  }

  private layerGuideCornerPoints(
    layerName: LayerName,
    left: number,
    top: number,
    right: number,
    bottom: number,
    size: number,
    edge: number,
  ): [number, number, number, number, number, number] {
    // A 45° edge needs √2 as much inset along x+y to stay the same thickness.
    const along = size - edge * (1 + Math.SQRT2);
    if (layerName === 'foreground') {
      return [left + edge, top + edge, left + along, top + edge, left + edge, top + along];
    }
    if (layerName === 'terrain') {
      return [right - edge, top + edge, right - along, top + edge, right - edge, top + along];
    }
    return [right - edge, bottom - edge, right - along, bottom - edge, right - edge, bottom - along];
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
