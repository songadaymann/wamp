import {
  TILESETS,
  TILE_SIZE,
  GAME_OBJECTS,
  editorState,
  getObjectDefaultFrame,
  getTilesetByKey,
  type TileSelection,
  type TilesetConfig,
} from '../../config';

const MIN_SELECTION_OPAQUE_PIXELS = 24;

export class PaletteController {
  private readonly doc: Document;
  private readonly paletteCanvas: HTMLCanvasElement | null;
  private readonly paletteContainer: HTMLElement | null;
  private readonly selectionInfo: HTMLElement | null;
  private readonly tilePreviewCanvas: HTMLCanvasElement | null;
  private readonly objectGrid: HTMLElement | null;

  private readonly paletteImages = new Map<string, HTMLImageElement>();
  private readonly paletteTileOccupancy = new Map<string, boolean[]>();
  private currentObjectCategory = 'all';
  private paletteDragStart: { col: number; row: number } | null = null;
  private objectTooltipEl: HTMLDivElement | null = null;

  constructor(doc: Document = document) {
    this.doc = doc;
    this.paletteCanvas = this.doc.getElementById('palette-canvas') as HTMLCanvasElement | null;
    this.paletteContainer = this.doc.getElementById('palette-container');
    this.selectionInfo = this.doc.getElementById('selection-info');
    this.tilePreviewCanvas = this.doc.getElementById('tile-preview') as HTMLCanvasElement | null;
    this.objectGrid = this.doc.getElementById('object-grid');
  }

  init(): void {
    this.loadPaletteImages();
    this.renderObjectGrid();
  }

  destroy(): void {
    if (this.paletteCanvas) {
      this.paletteCanvas.onmousedown = null;
      this.paletteCanvas.onmousemove = null;
      this.paletteCanvas.onmouseup = null;
      this.paletteCanvas.onmouseleave = null;
      this.paletteCanvas.onclick = null;
    }

    this.objectTooltipEl?.remove();
    this.objectTooltipEl = null;
  }

  setObjectCategory(category: string): void {
    this.currentObjectCategory = category || 'all';
    this.renderObjectGrid();
  }

  updateSelection(
    tilesetKey: string,
    col1: number,
    row1: number,
    col2: number,
    row2: number,
  ): void {
    const startCol = Math.min(col1, col2);
    const startRow = Math.min(row1, row2);
    const endCol = Math.max(col1, col2);
    const endRow = Math.max(row1, row2);

    const ts = getTilesetByKey(tilesetKey);
    if (!ts) {
      return;
    }

    const nextSelection: TileSelection = {
      tilesetKey,
      startCol,
      startRow,
      width: endCol - startCol + 1,
      height: endRow - startRow + 1,
      occupiedMask: this.buildSelectionOccupiedMask(
        tilesetKey,
        startCol,
        startRow,
        endCol - startCol + 1,
        endRow - startRow + 1,
      ),
    };
    editorState.selection = nextSelection;
    editorState.selectedTileGid = this.getPrimarySelectionGid(nextSelection, ts);

    if (this.selectionInfo) {
      const occupiedCount = this.countOccupiedSelectionCells(nextSelection);
      const totalCells = nextSelection.width * nextSelection.height;

      if (totalCells === 1) {
        this.selectionInfo.textContent = occupiedCount === 0 ? '(empty)' : '';
      } else if (occupiedCount === totalCells) {
        this.selectionInfo.textContent = `(${nextSelection.width}x${nextSelection.height})`;
      } else {
        this.selectionInfo.textContent = `(${nextSelection.width}x${nextSelection.height}, ${occupiedCount} tiles)`;
      }
    }

    this.renderPalette();
    this.renderTilePreview();
  }

  renderPalette(): void {
    if (!this.paletteCanvas || !this.paletteContainer) {
      return;
    }

    const ts = getTilesetByKey(editorState.selectedTilesetKey);
    const img = this.paletteImages.get(editorState.selectedTilesetKey);
    if (!ts || !img) {
      return;
    }

    const availableWidth = this.paletteContainer.clientWidth - 4;
    const scale = Math.max(1, availableWidth / ts.imageWidth);
    const scaledWidth = Math.floor(ts.imageWidth * scale);
    const scaledHeight = Math.floor(ts.imageHeight * scale);
    const scaledTile = TILE_SIZE * scale;

    this.paletteCanvas.width = scaledWidth;
    this.paletteCanvas.height = scaledHeight;
    this.paletteCanvas.style.width = `${scaledWidth}px`;
    this.paletteCanvas.style.height = `${scaledHeight}px`;

    const ctx = this.paletteCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= ts.columns; x++) {
      ctx.beginPath();
      ctx.moveTo(Math.floor(x * scaledTile) + 0.5, 0);
      ctx.lineTo(Math.floor(x * scaledTile) + 0.5, scaledHeight);
      ctx.stroke();
    }

    for (let y = 0; y <= ts.rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, Math.floor(y * scaledTile) + 0.5);
      ctx.lineTo(scaledWidth, Math.floor(y * scaledTile) + 0.5);
      ctx.stroke();
    }

    const selection = editorState.selection;
    if (selection.tilesetKey === ts.key) {
      ctx.strokeStyle = '#5577ff';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(85, 119, 255, 0.15)';

      const sx = Math.floor(selection.startCol * scaledTile) + 1;
      const sy = Math.floor(selection.startRow * scaledTile) + 1;
      const sw = Math.floor(selection.width * scaledTile) - 2;
      const sh = Math.floor(selection.height * scaledTile) - 2;

      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeRect(sx, sy, sw, sh);
      this.drawSelectionEmptyCellOverlay(ctx, selection, scaledTile, scaledTile, sx - 1, sy - 1);
    }

    this.paletteCanvas.onmousedown = (event: MouseEvent) => {
      const rect = this.paletteCanvas?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const col = Math.floor(x / scaledTile);
      const row = Math.floor(y / scaledTile);

      if (col >= 0 && col < ts.columns && row >= 0 && row < ts.rows) {
        this.paletteDragStart = { col, row };
        this.updateSelection(ts.key, col, row, col, row);
      }
    };

    this.paletteCanvas.onmousemove = (event: MouseEvent) => {
      if (!this.paletteDragStart) {
        return;
      }

      const rect = this.paletteCanvas?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const col = Math.min(ts.columns - 1, Math.max(0, Math.floor(x / scaledTile)));
      const row = Math.min(ts.rows - 1, Math.max(0, Math.floor(y / scaledTile)));

      this.updateSelection(ts.key, this.paletteDragStart.col, this.paletteDragStart.row, col, row);
    };

    this.paletteCanvas.onmouseup = () => {
      this.paletteDragStart = null;
    };

    this.paletteCanvas.onmouseleave = () => {
      if (this.paletteDragStart) {
        this.paletteDragStart = null;
      }
    };

    this.paletteCanvas.onclick = null;
  }

  renderTilePreview(): void {
    if (!this.tilePreviewCanvas) {
      return;
    }

    const ctx = this.tilePreviewCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.imageSmoothingEnabled = false;

    if (editorState.paletteMode === 'objects' && editorState.selectedObjectId) {
      const selectedObject = GAME_OBJECTS.find((objectConfig) => objectConfig.id === editorState.selectedObjectId);
      if (selectedObject) {
        const objectImage = new Image();
        objectImage.src = selectedObject.path;
        objectImage.onload = () => {
          this.tilePreviewCanvas!.width = 64;
          this.tilePreviewCanvas!.height = 64;
          ctx.clearRect(0, 0, 64, 64);

          const previewScale = Math.min(64 / selectedObject.frameWidth, 64 / selectedObject.frameHeight);
          const drawWidth = Math.floor(selectedObject.frameWidth * previewScale);
          const drawHeight = Math.floor(selectedObject.frameHeight * previewScale);
          const offsetX = Math.floor((64 - drawWidth) / 2);
          const offsetY = Math.floor((64 - drawHeight) / 2);

          ctx.drawImage(
            objectImage,
            0,
            0,
            selectedObject.frameWidth,
            selectedObject.frameHeight,
            offsetX,
            offsetY,
            drawWidth,
            drawHeight,
          );
        };
        return;
      }
    }

    const selection = editorState.selection;
    const ts = getTilesetByKey(selection.tilesetKey);
    const img = this.paletteImages.get(selection.tilesetKey);
    if (!ts || !img) {
      return;
    }

    const selectionPixelWidth = selection.width * TILE_SIZE;
    const selectionPixelHeight = selection.height * TILE_SIZE;
    const previewScale = Math.min(64 / selectionPixelWidth, 64 / selectionPixelHeight);
    const drawWidth = Math.floor(selectionPixelWidth * previewScale);
    const drawHeight = Math.floor(selectionPixelHeight * previewScale);

    this.tilePreviewCanvas.width = 64;
    this.tilePreviewCanvas.height = 64;
    ctx.clearRect(0, 0, 64, 64);

    const offsetX = Math.floor((64 - drawWidth) / 2);
    const offsetY = Math.floor((64 - drawHeight) / 2);

    ctx.drawImage(
      img,
      selection.startCol * TILE_SIZE,
      selection.startRow * TILE_SIZE,
      selectionPixelWidth,
      selectionPixelHeight,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    );

    this.drawSelectionEmptyCellOverlay(
      ctx,
      selection,
      drawWidth / selection.width,
      drawHeight / selection.height,
      offsetX,
      offsetY,
    );
  }

  renderObjectGrid(): void {
    if (!this.objectGrid) {
      return;
    }

    this.objectGrid.innerHTML = '';

    const filteredObjects =
      this.currentObjectCategory === 'all'
        ? GAME_OBJECTS
        : GAME_OBJECTS.filter((objectConfig) => {
            if (this.currentObjectCategory === 'interactive') {
              return objectConfig.category === 'interactive' || objectConfig.category === 'platform';
            }

            return objectConfig.category === this.currentObjectCategory;
          });

    for (const objectConfig of filteredObjects) {
      const item = this.doc.createElement('div');
      item.className = 'object-item';
      if (editorState.selectedObjectId === objectConfig.id) {
        item.classList.add('active');
      }
      item.dataset.objectId = objectConfig.id;

      item.addEventListener('mouseenter', (event) => {
        this.showObjectTooltip(
          event.currentTarget as HTMLElement,
          `${objectConfig.name} — ${objectConfig.description}`,
        );
      });
      item.addEventListener('mouseleave', () => this.hideObjectTooltip());

      const img = this.doc.createElement('img');
      img.src = objectConfig.path;
      if (objectConfig.frameCount > 1) {
        const canvas = this.doc.createElement('canvas');
        canvas.width = objectConfig.frameWidth;
        canvas.height = objectConfig.frameHeight;
        const srcImg = new Image();
        srcImg.src = objectConfig.path;
        srcImg.onload = () => {
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return;
          }

          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            srcImg,
            getObjectDefaultFrame(objectConfig) * objectConfig.frameWidth,
            0,
            objectConfig.frameWidth,
            objectConfig.frameHeight,
            0,
            0,
            objectConfig.frameWidth,
            objectConfig.frameHeight,
          );
          img.src = canvas.toDataURL();
        };
      }

      const label = this.doc.createElement('div');
      label.className = 'object-item-label';
      label.textContent = objectConfig.name;

      item.appendChild(img);
      item.appendChild(label);

      item.addEventListener('click', () => {
        editorState.selectedObjectId = objectConfig.id;
        this.doc.querySelectorAll('.object-item').forEach((element) => element.classList.remove('active'));
        item.classList.add('active');

        editorState.activeTool = 'pencil';
        this.doc.querySelectorAll('.tool-btn').forEach((button) => {
          button.classList.toggle('active', (button as HTMLElement).dataset.tool === 'pencil');
        });

        this.renderTilePreview();
      });

      this.objectGrid.appendChild(item);
    }
  }

  private loadPaletteImages(): void {
    let loadedCount = 0;

    for (const ts of TILESETS) {
      const img = new Image();
      img.src = ts.path;
      img.onload = () => {
        this.paletteImages.set(ts.key, img);
        this.paletteTileOccupancy.set(ts.key, this.computeTilesetOccupancy(ts, img));
        loadedCount++;

        if (loadedCount === TILESETS.length) {
          this.renderPalette();
          this.renderTilePreview();
        }
      };
    }
  }

  private getObjectTooltip(): HTMLDivElement {
    if (!this.objectTooltipEl) {
      this.objectTooltipEl = this.doc.createElement('div');
      this.objectTooltipEl.id = 'object-tooltip';
      this.doc.body.appendChild(this.objectTooltipEl);
    }

    return this.objectTooltipEl;
  }

  private showObjectTooltip(anchor: HTMLElement, text: string): void {
    const tooltip = this.getObjectTooltip();
    tooltip.textContent = text;
    const rect = anchor.getBoundingClientRect();
    tooltip.style.left = `${rect.right + 8}px`;
    tooltip.style.top = `${rect.top + rect.height / 2}px`;
    tooltip.style.transform = 'translateY(-50%)';
    tooltip.classList.add('visible');
  }

  private hideObjectTooltip(): void {
    this.objectTooltipEl?.classList.remove('visible');
  }

  private computeTilesetOccupancy(ts: TilesetConfig, img: HTMLImageElement): boolean[] {
    const canvas = this.doc.createElement('canvas');
    canvas.width = ts.imageWidth;
    canvas.height = ts.imageHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return new Array(ts.tileCount).fill(true);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, ts.imageWidth, ts.imageHeight);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const occupied = new Array(ts.tileCount).fill(false);

    for (let row = 0; row < ts.rows; row++) {
      for (let col = 0; col < ts.columns; col++) {
        const tileIndex = row * ts.columns + col;
        occupied[tileIndex] = this.tileHasVisiblePixels(imageData, col, row);
      }
    }

    return occupied;
  }

  private tileHasVisiblePixels(imageData: ImageData, tileCol: number, tileRow: number): boolean {
    const startX = tileCol * TILE_SIZE;
    const startY = tileRow * TILE_SIZE;
    const endX = startX + TILE_SIZE;
    const endY = startY + TILE_SIZE;

    let opaquePixelCount = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const alphaIndex = (y * imageData.width + x) * 4 + 3;
        if (imageData.data[alphaIndex] > 0) {
          opaquePixelCount++;
          if (opaquePixelCount >= MIN_SELECTION_OPAQUE_PIXELS) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private buildSelectionOccupiedMask(
    tilesetKey: string,
    startCol: number,
    startRow: number,
    width: number,
    height: number,
  ): boolean[][] {
    const ts = getTilesetByKey(tilesetKey);
    const occupancy = this.paletteTileOccupancy.get(tilesetKey);

    if (!ts || !occupancy) {
      return Array.from({ length: height }, () => Array.from({ length: width }, () => true));
    }

    return Array.from({ length: height }, (_, dy) =>
      Array.from({ length: width }, (_, dx) => {
        const tileIndex = (startRow + dy) * ts.columns + startCol + dx;
        return occupancy[tileIndex] ?? true;
      }),
    );
  }

  private countOccupiedSelectionCells(selection: TileSelection): number {
    let occupiedCount = 0;

    for (const row of selection.occupiedMask) {
      for (const occupied of row) {
        if (occupied) {
          occupiedCount++;
        }
      }
    }

    return occupiedCount;
  }

  private getPrimarySelectionGid(selection: TileSelection, ts: TilesetConfig): number {
    for (let dy = 0; dy < selection.height; dy++) {
      for (let dx = 0; dx < selection.width; dx++) {
        if (!selection.occupiedMask[dy]?.[dx]) {
          continue;
        }

        const col = selection.startCol + dx;
        const row = selection.startRow + dy;
        return ts.firstGid + row * ts.columns + col;
      }
    }

    return -1;
  }

  private drawSelectionEmptyCellOverlay(
    ctx: CanvasRenderingContext2D,
    selection: TileSelection,
    cellWidth: number,
    cellHeight: number,
    offsetX: number,
    offsetY: number,
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 6, 10, 0.45)';
    ctx.strokeStyle = 'rgba(255, 210, 145, 0.7)';
    ctx.lineWidth = Math.max(1, Math.min(2, Math.min(cellWidth, cellHeight) * 0.08));

    for (let dy = 0; dy < selection.height; dy++) {
      for (let dx = 0; dx < selection.width; dx++) {
        if (selection.occupiedMask[dy]?.[dx]) {
          continue;
        }

        const left = offsetX + dx * cellWidth;
        const top = offsetY + dy * cellHeight;
        const inset = Math.max(1, Math.min(cellWidth, cellHeight) * 0.12);
        const width = Math.max(1, cellWidth - inset * 2);
        const height = Math.max(1, cellHeight - inset * 2);

        ctx.fillRect(left + inset, top + inset, width, height);
        ctx.beginPath();
        ctx.moveTo(left + inset, top + inset);
        ctx.lineTo(left + inset + width, top + inset + height);
        ctx.moveTo(left + inset + width, top + inset);
        ctx.lineTo(left + inset, top + inset + height);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
