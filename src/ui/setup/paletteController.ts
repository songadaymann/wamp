import {
  TILESETS,
  TILE_SIZE,
  colorNumberToCssHex,
  colorNumberToCssRgba,
  editorState,
  getObjectDefaultFrame,
  getObjectFrameSourceRect,
  getTilesetByKey,
  getTilesetEditorPaletteBackgroundColor,
  getTilesetUiTheme,
  isTilesetLocalTileEditorEnabled,
  MOVING_PLATFORM_OBJECT_ID,
  SPECIAL_TILE_LOCAL_INDICES,
  SPECIAL_TILESET_KEY,
  type GameObjectConfig,
  type TileSelection,
  type TilesetConfig,
} from '../../config';
import {
  getEditorObjectConfigById,
  listEditorObjectConfigs,
} from '../../customSprites/objectConfig';
import { parseCustomSpriteObjectId } from '../../customSprites/model';
import { getCustomSpriteDefinitionByObjectId, isLocalCustomSpriteId } from '../../customSprites/registry';
import { EDITOR_UI_STATE_CHANGED_EVENT } from '../../scenes/editor/uiEvents';
import { getDeviceLayoutState, isCoarsePointerDevice } from '../deviceLayout';

const MIN_SELECTION_OPAQUE_PIXELS = 96;
const CUSTOM_OBJECT_SUBCATEGORIES = ['all', 'decoration', 'collectible', 'sign', 'solid', 'pushable'] as const;

type CustomObjectSubcategory = (typeof CUSTOM_OBJECT_SUBCATEGORIES)[number];
type CustomObjectKindSubcategory = Exclude<CustomObjectSubcategory, 'all'>;

type PaletteTooltipContent = {
  title: string;
  description?: string;
};

export class PaletteController {
  private readonly doc: Document;
  private readonly paletteCanvas: HTMLCanvasElement | null;
  private readonly paletteContainer: HTMLElement | null;
  private readonly selectionInfo: HTMLElement | null;
  private readonly tilePreviewCanvas: HTMLCanvasElement | null;
  private readonly objectPaletteSection: HTMLElement | null;
  private readonly objectGrid: HTMLElement | null;
  private readonly objectSearchInput: HTMLInputElement | null;
  private readonly customObjectSubcategoryTabs: HTMLButtonElement[];
  private readonly customObjectSubcategoryControls: HTMLElement | null;
  private readonly objectFacingControls: HTMLElement | null;
  private readonly objectFacingLeftBtn: HTMLButtonElement | null;
  private readonly objectFacingRightBtn: HTMLButtonElement | null;
  private readonly objectSelectionDetails: HTMLElement | null;
  private readonly objectSelectionName: HTMLElement | null;
  private readonly objectSelectionDescription: HTMLElement | null;

  private readonly paletteImages = new Map<string, HTMLImageElement>();
  private readonly paletteTileOccupancy = new Map<string, boolean[]>();
  private readonly paletteTileVisibility = new Map<string, boolean[]>();
  private currentObjectCategory = 'all';
  private currentCustomObjectSubcategory: CustomObjectSubcategory = 'all';
  private currentObjectSearch = '';
  private paletteDragStart: { col: number; row: number } | null = null;
  private paletteTooltipEl: HTMLDivElement | null = null;

  constructor(doc: Document = document) {
    this.doc = doc;
    this.paletteCanvas = this.doc.getElementById('palette-canvas') as HTMLCanvasElement | null;
    this.paletteContainer = this.doc.getElementById('palette-container');
    this.selectionInfo = this.doc.getElementById('selection-info');
    this.tilePreviewCanvas = this.doc.getElementById('tile-preview') as HTMLCanvasElement | null;
    this.objectPaletteSection = this.doc.getElementById('object-palette-section');
    this.objectGrid = this.doc.getElementById('object-grid');
    this.objectSearchInput = this.doc.getElementById('object-search-input') as HTMLInputElement | null;
    this.customObjectSubcategoryControls = this.doc.getElementById('custom-object-subcategory-tabs');
    this.customObjectSubcategoryTabs = Array.from(
      this.doc.querySelectorAll<HTMLButtonElement>('.object-subcategory-tab'),
    );
    this.objectFacingControls = this.doc.getElementById('object-facing-controls');
    this.objectFacingLeftBtn = this.doc.getElementById('btn-object-facing-left') as HTMLButtonElement | null;
    this.objectFacingRightBtn = this.doc.getElementById('btn-object-facing-right') as HTMLButtonElement | null;
    this.objectSelectionDetails = this.doc.getElementById('object-selection-details');
    this.objectSelectionName = this.doc.getElementById('object-selection-name');
    this.objectSelectionDescription = this.doc.getElementById('object-selection-description');
  }

  init(): void {
    this.loadPaletteImages();
    this.bindObjectSearchInput();
    this.bindCustomObjectSubcategoryTabs();
    this.bindObjectFacingControls();
    this.renderObjectGrid();
    this.renderObjectFacingControls();
    this.renderObjectSelectionDetails();
  }

  destroy(): void {
    if (this.paletteCanvas) {
      this.paletteCanvas.onpointerdown = null;
      this.paletteCanvas.onpointermove = null;
      this.paletteCanvas.onpointerup = null;
      this.paletteCanvas.onpointercancel = null;
      this.paletteCanvas.onpointerleave = null;
      this.paletteCanvas.onclick = null;
    }

    this.paletteTooltipEl?.remove();
    this.paletteTooltipEl = null;
    if (this.objectSearchInput) {
      this.objectSearchInput.oninput = null;
      this.objectSearchInput.onchange = null;
    }
    for (const tab of this.customObjectSubcategoryTabs) {
      tab.onclick = null;
    }
  }

  setObjectCategory(category: string): void {
    this.currentObjectCategory = category || 'all';
    if (!this.isCustomObjectCategoryFilter(this.currentObjectCategory)) {
      this.currentCustomObjectSubcategory = 'all';
    }
    this.resetObjectGridScroll();
    this.renderCustomObjectSubcategoryTabs();
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
    const tilesetChanged = editorState.selectedTilesetKey !== tilesetKey;
    editorState.selectedTilesetKey = tilesetKey;

    const nextSelection = this.normalizeSelection(
      this.createSelection(
        tilesetKey,
        startCol,
        startRow,
        endCol - startCol + 1,
        endRow - startRow + 1,
      ),
    );
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
        this.selectionInfo.textContent = `(${nextSelection.width}x${nextSelection.height}, ${occupiedCount} terrain cells)`;
      }
    }

    this.renderPalette();
    this.renderTilePreview();
    if (tilesetChanged) {
      this.doc.defaultView?.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
    }
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
    const layout = getDeviceLayoutState();
    const maxScale =
      layout.deviceClass === 'phone' && layout.coarsePointer
        ? 2
        : Number.POSITIVE_INFINITY;
    const scale = Math.min(maxScale, Math.max(1, availableWidth / ts.imageWidth));
    const scaledWidth = Math.floor(ts.imageWidth * scale);
    const scaledHeight = Math.floor(ts.imageHeight * scale);
    const scaledTile = TILE_SIZE * scale;

    this.paletteCanvas.width = scaledWidth;
    this.paletteCanvas.height = scaledHeight;
    this.paletteCanvas.style.width = `${scaledWidth}px`;
    this.paletteCanvas.style.height = `${scaledHeight}px`;
    this.paletteCanvas.style.background = getTilesetEditorPaletteBackgroundColor(ts.key);
    this.paletteCanvas.style.touchAction = 'none';

    const ctx = this.paletteCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = getTilesetEditorPaletteBackgroundColor(ts.key);
    ctx.fillRect(0, 0, scaledWidth, scaledHeight);
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    this.drawDisabledTileOverlays(ctx, ts, scaledTile);

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
      const theme = getTilesetUiTheme(editorState.selectedTilesetKey);
      ctx.strokeStyle = colorNumberToCssHex(theme.accentCool);
      ctx.lineWidth = 2;
      ctx.fillStyle = colorNumberToCssRgba(theme.accentCool, 0.15);

      const sx = Math.floor(selection.startCol * scaledTile) + 1;
      const sy = Math.floor(selection.startRow * scaledTile) + 1;
      const sw = Math.floor(selection.width * scaledTile) - 2;
      const sh = Math.floor(selection.height * scaledTile) - 2;

      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeRect(sx, sy, sw, sh);
      this.drawSelectionEmptyCellOverlay(ctx, selection, scaledTile, scaledTile, sx - 1, sy - 1);
    }

    this.paletteCanvas.onpointerdown = (event: PointerEvent) => {
      this.hidePaletteTooltip();
      const rect = this.paletteCanvas?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const col = Math.floor(x / scaledTile);
      const row = Math.floor(y / scaledTile);

      if (col >= 0 && col < ts.columns && row >= 0 && row < ts.rows) {
        if (this.handleSpecialPaletteTileShortcut(ts, row * ts.columns + col)) {
          return;
        }
        this.paletteDragStart = { col, row };
        this.updateSelection(ts.key, col, row, col, row);
        this.paletteCanvas?.setPointerCapture(event.pointerId);
      }
    };

    this.paletteCanvas.onpointermove = (event: PointerEvent) => {
      if (!this.paletteDragStart) {
        this.updatePaletteTileTooltip(event, ts, scaledTile);
        return;
      }

      this.hidePaletteTooltip();
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

    this.paletteCanvas.onpointerup = () => {
      if (this.paletteDragStart) {
        this.paletteDragStart = null;
        this.requestPhoneEditorAutoCollapse();
      }
    };

    this.paletteCanvas.onpointercancel = () => {
      if (this.paletteDragStart) {
        this.paletteDragStart = null;
      }
      this.hidePaletteTooltip();
    };

    this.paletteCanvas.onpointerleave = () => {
      if (this.paletteDragStart) {
        this.paletteDragStart = null;
      }
      this.hidePaletteTooltip();
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
      const selectedObject = getEditorObjectConfigById(editorState.selectedObjectId);
      if (selectedObject) {
        const objectImage = new Image();
        objectImage.src = selectedObject.path;
        objectImage.onload = () => {
          this.tilePreviewCanvas!.width = 64;
          this.tilePreviewCanvas!.height = 64;
          this.tilePreviewCanvas!.style.background = '';
          ctx.clearRect(0, 0, 64, 64);

          const sourceSize = this.getObjectPreviewSourceSize(selectedObject);
          const previewScale = Math.min(64 / sourceSize.width, 64 / sourceSize.height);
          const drawWidth = Math.floor(sourceSize.width * previewScale);
          const drawHeight = Math.floor(sourceSize.height * previewScale);
          const offsetX = Math.floor((64 - drawWidth) / 2);
          const offsetY = Math.floor((64 - drawHeight) / 2);

          this.drawObjectFrame(
            ctx,
            selectedObject,
            objectImage,
            getObjectDefaultFrame(selectedObject),
            offsetX,
            offsetY,
            drawWidth,
            drawHeight,
            this.shouldFlipSelectedObject(selectedObject)
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
    this.tilePreviewCanvas.style.background = getTilesetEditorPaletteBackgroundColor(ts.key);
    ctx.clearRect(0, 0, 64, 64);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = getTilesetEditorPaletteBackgroundColor(ts.key);
    ctx.fillRect(0, 0, 64, 64);

    const offsetX = Math.floor((64 - drawWidth) / 2);
    const offsetY = Math.floor((64 - drawHeight) / 2);
    const cellWidth = drawWidth / selection.width;
    const cellHeight = drawHeight / selection.height;

    for (let dy = 0; dy < selection.height; dy += 1) {
      for (let dx = 0; dx < selection.width; dx += 1) {
        if (!selection.occupiedMask[dy]?.[dx]) {
          continue;
        }

        const sourceDx = editorState.tileFlipX ? selection.width - 1 - dx : dx;
        const sourceDy = editorState.tileFlipY ? selection.height - 1 - dy : dy;
        const sourceCol = selection.startCol + sourceDx;
        const sourceRow = selection.startRow + sourceDy;

        ctx.save();
        ctx.translate(
          offsetX + dx * cellWidth + (editorState.tileFlipX ? cellWidth : 0),
          offsetY + dy * cellHeight + (editorState.tileFlipY ? cellHeight : 0),
        );
        ctx.scale(editorState.tileFlipX ? -1 : 1, editorState.tileFlipY ? -1 : 1);
        ctx.drawImage(
          img,
          sourceCol * TILE_SIZE,
          sourceRow * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
          0,
          0,
          cellWidth,
          cellHeight,
        );
        ctx.restore();
      }
    }

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

    this.renderCustomObjectSubcategoryTabs();
    this.objectGrid.innerHTML = '';

    const filteredObjects = listEditorObjectConfigs().filter((objectConfig) => (
      this.matchesObjectCategoryFilter(objectConfig) &&
      this.matchesObjectSearchFilter(objectConfig)
    ));

    if (filteredObjects.length === 0) {
      const emptyState = this.doc.createElement('div');
      emptyState.className = 'object-grid-empty';
      emptyState.textContent = 'No objects match this filter.';
      this.objectGrid.appendChild(emptyState);
      this.renderObjectSelectionDetails();
      this.renderObjectFacingControls();
      return;
    }

    for (const objectConfig of filteredObjects) {
      const item = this.doc.createElement('div');
      item.className = 'object-item';
      item.setAttribute('aria-label', objectConfig.name);
      if (editorState.selectedObjectId === objectConfig.id) {
        item.classList.add('active');
      }
      item.dataset.objectId = objectConfig.id;

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
          const sourceSize = this.getObjectPreviewSourceSize(objectConfig);
          const previewScale = Math.min(canvas.width / sourceSize.width, canvas.height / sourceSize.height);
          const drawWidth = Math.max(1, Math.floor(sourceSize.width * previewScale));
          const drawHeight = Math.max(1, Math.floor(sourceSize.height * previewScale));
          const offsetX = Math.floor((canvas.width - drawWidth) / 2);
          const offsetY = Math.floor((canvas.height - drawHeight) / 2);
          this.drawObjectFrame(
            ctx,
            objectConfig,
            srcImg,
            getObjectDefaultFrame(objectConfig),
            offsetX,
            offsetY,
            drawWidth,
            drawHeight,
            false,
          );
          img.src = canvas.toDataURL();
        };
      }

      item.appendChild(img);

      item.addEventListener('click', () => {
        editorState.selectedObjectId = objectConfig.id;
        editorState.objectFacing = objectConfig.facingDirection ?? 'right';
        this.doc.querySelectorAll('.object-item').forEach((element) => element.classList.remove('active'));
        item.classList.add('active');

        editorState.activeTool = 'pencil';
        this.renderObjectSelectionDetails();
        this.renderObjectFacingControls();
        this.renderTilePreview();
        this.doc.defaultView?.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
        this.requestPhoneEditorAutoCollapse();
        this.focusGameCanvasForShortcuts();
      });

      this.objectGrid.appendChild(item);
    }

    this.renderObjectSelectionDetails();
    this.renderObjectFacingControls();
  }

  private bindObjectSearchInput(): void {
    if (!this.objectSearchInput) {
      return;
    }

    const applySearch = () => {
      this.currentObjectSearch = this.objectSearchInput?.value.trim().toLowerCase() ?? '';
      this.resetObjectGridScroll();
      this.renderObjectGrid();
    };

    this.currentObjectSearch = this.objectSearchInput.value.trim().toLowerCase();
    this.objectSearchInput.oninput = applySearch;
    this.objectSearchInput.onchange = applySearch;
  }

  private setObjectSearch(query: string): void {
    this.currentObjectSearch = query.trim().toLowerCase();
    if (this.objectSearchInput) {
      this.objectSearchInput.value = query;
    }
  }

  private focusGameCanvasForShortcuts(): void {
    const activeElement = this.doc.activeElement;
    if (activeElement instanceof HTMLElement && this.objectPaletteSection?.contains(activeElement)) {
      activeElement.blur();
    }

    const gameCanvas = this.findPrimaryGameCanvas();
    if (!gameCanvas) {
      return;
    }

    if (gameCanvas.tabIndex < 0) {
      gameCanvas.tabIndex = 0;
    }
    gameCanvas.focus({ preventScroll: true });
  }

  private findPrimaryGameCanvas(): HTMLCanvasElement | null {
    let bestCanvas: HTMLCanvasElement | null = null;
    let bestArea = 0;
    for (const canvas of this.doc.querySelectorAll<HTMLCanvasElement>('#game-container canvas')) {
      const area = (canvas.clientWidth || canvas.width) * (canvas.clientHeight || canvas.height);
      if (area > bestArea) {
        bestArea = area;
        bestCanvas = canvas;
      }
    }

    return bestCanvas;
  }

  private bindCustomObjectSubcategoryTabs(): void {
    for (const tab of this.customObjectSubcategoryTabs) {
      tab.onclick = () => {
        this.currentCustomObjectSubcategory = this.normalizeCustomObjectSubcategory(
          tab.dataset.customObjectCategory,
        );
        this.resetObjectGridScroll();
        this.renderCustomObjectSubcategoryTabs();
        this.renderObjectGrid();
      };
    }
  }

  private renderCustomObjectSubcategoryTabs(): void {
    const visible = this.isCustomObjectCategoryFilter(this.currentObjectCategory);
    this.objectPaletteSection?.classList.toggle('has-custom-subcategories', visible);
    this.objectPaletteSection?.setAttribute('data-object-category', this.currentObjectCategory);
    this.customObjectSubcategoryControls?.classList.toggle('hidden', !visible);

    for (const tab of this.customObjectSubcategoryTabs) {
      const tabCategory = this.normalizeCustomObjectSubcategory(tab.dataset.customObjectCategory);
      const active = visible && tabCategory === this.currentCustomObjectSubcategory;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  private renderObjectSelectionDetails(): void {
    if (!this.objectSelectionDetails || !this.objectSelectionName || !this.objectSelectionDescription) {
      return;
    }

    const selectedObject = this.getSelectedObjectConfig();
    if (!selectedObject) {
      this.objectSelectionDetails.classList.add('is-empty');
      this.objectSelectionName.textContent = 'Pick an object';
      this.objectSelectionDescription.textContent = 'Click an object, then click on the canvas to place.';
      return;
    }

    this.objectSelectionDetails.classList.remove('is-empty');
    this.objectSelectionName.textContent = selectedObject.name;
    this.objectSelectionDescription.textContent = selectedObject.description.trim() || 'No description available.';
  }

  private resetObjectGridScroll(): void {
    if (!this.objectGrid) {
      return;
    }

    this.objectGrid.scrollTop = 0;
    this.objectGrid.scrollLeft = 0;
  }

  private requestPhoneEditorAutoCollapse(): void {
    this.doc.defaultView?.dispatchEvent(new Event('mobile-editor-auto-collapse'));
  }

  private bindObjectFacingControls(): void {
    const applyFacing = (facing: 'left' | 'right') => {
      const selectedObject = this.getSelectedObjectConfig();
      if (!selectedObject?.facingDirection) {
        return;
      }

      editorState.objectFacing = facing;
      this.renderObjectFacingControls();
      this.renderTilePreview();
    };

    this.objectFacingLeftBtn?.addEventListener('click', () => applyFacing('left'));
    this.objectFacingRightBtn?.addEventListener('click', () => applyFacing('right'));
  }

  private renderObjectFacingControls(): void {
    const selectedObject = this.getSelectedObjectConfig();
    const visible = Boolean(selectedObject?.facingDirection);
    this.objectFacingControls?.classList.toggle('hidden', !visible);
    this.objectFacingLeftBtn?.classList.toggle('active', visible && editorState.objectFacing === 'left');
    this.objectFacingRightBtn?.classList.toggle('active', visible && editorState.objectFacing === 'right');
  }

  private loadPaletteImages(): void {
    let loadedCount = 0;

    for (const ts of TILESETS) {
      const img = new Image();
      img.src = ts.path;
      img.onload = () => {
        this.paletteImages.set(ts.key, img);
        this.paletteTileOccupancy.set(ts.key, this.computeTilesetOccupancy(ts, img));
        this.paletteTileVisibility.set(ts.key, this.computeTilesetVisibility(ts, img));
        loadedCount++;

        if (loadedCount === TILESETS.length) {
          this.ensureSelectionIsUsable();
          this.renderPalette();
          this.renderTilePreview();
        }
      };
    }
  }

  private createSelection(
    tilesetKey: string,
    startCol: number,
    startRow: number,
    width: number,
    height: number,
  ): TileSelection {
    return {
      tilesetKey,
      startCol,
      startRow,
      width,
      height,
      occupiedMask: this.buildSelectionOccupiedMask(
        tilesetKey,
        startCol,
        startRow,
        width,
        height,
      ),
    };
  }

  private ensureSelectionIsUsable(): void {
    const activeTilesetKey = editorState.selectedTilesetKey;
    const currentSelection = editorState.selection;
    const currentSelectionHasOccupiedCell = this.selectionHasOccupiedCells(currentSelection);
    if (
      currentSelection.tilesetKey === activeTilesetKey &&
      currentSelectionHasOccupiedCell
    ) {
      return;
    }

    const fallbackCell = this.findFirstVisibleTile(activeTilesetKey);
    if (!fallbackCell) {
      return;
    }

    const normalizedSelection = this.createSelection(
      activeTilesetKey,
      fallbackCell.col,
      fallbackCell.row,
      1,
      1,
    );
    const ts = getTilesetByKey(activeTilesetKey);
    if (!ts) {
      return;
    }

    editorState.selection = normalizedSelection;
    editorState.selectedTileGid = this.getPrimarySelectionGid(normalizedSelection, ts);
  }

  private getPaletteTooltip(): HTMLDivElement {
    if (!this.paletteTooltipEl) {
      this.paletteTooltipEl = this.doc.createElement('div');
      this.paletteTooltipEl.id = 'palette-tooltip';
      this.doc.body.appendChild(this.paletteTooltipEl);
    }

    return this.paletteTooltipEl;
  }

  private showPaletteTooltip(
    left: number,
    centerY: number,
    content: PaletteTooltipContent,
  ): void {
    const tooltip = this.getPaletteTooltip();
    tooltip.textContent = '';

    const title = this.doc.createElement('div');
    title.className = 'palette-tooltip-title';
    title.textContent = content.title;
    tooltip.appendChild(title);

    const descriptionText = content.description?.trim();
    if (descriptionText) {
      const description = this.doc.createElement('div');
      description.className = 'palette-tooltip-description';
      description.textContent = descriptionText;
      tooltip.appendChild(description);
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${centerY}px`;
    tooltip.style.transform = 'translateY(-50%)';
    tooltip.classList.add('visible');
  }

  private hidePaletteTooltip(): void {
    this.paletteTooltipEl?.classList.remove('visible');
  }

  private updatePaletteTileTooltip(
    event: PointerEvent,
    ts: TilesetConfig,
    scaledTile: number,
  ): void {
    if (
      isCoarsePointerDevice() ||
      ts.key !== SPECIAL_TILESET_KEY ||
      !this.paletteCanvas
    ) {
      this.hidePaletteTooltip();
      return;
    }

    const rect = this.paletteCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.hidePaletteTooltip();
      return;
    }

    const canvasScaleX = this.paletteCanvas.width / rect.width;
    const canvasScaleY = this.paletteCanvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * canvasScaleX;
    const canvasY = (event.clientY - rect.top) * canvasScaleY;
    const col = Math.floor(canvasX / scaledTile);
    const row = Math.floor(canvasY / scaledTile);

    if (col < 0 || col >= ts.columns || row < 0 || row >= ts.rows) {
      this.hidePaletteTooltip();
      return;
    }

    const tileIndex = row * ts.columns + col;
    const metadata = ts.editorTileMetadata?.[tileIndex];
    const isObjectShortcut = tileIndex === SPECIAL_TILE_LOCAL_INDICES.movingPlatformTile;
    if (!metadata || (!metadata.enabled && !isObjectShortcut)) {
      this.hidePaletteTooltip();
      return;
    }

    const cellWidth = rect.width / ts.columns;
    const cellHeight = rect.height / ts.rows;
    const tooltipLeft = rect.left + (col + 1) * cellWidth + 8;
    const tooltipCenterY = rect.top + (row + 0.5) * cellHeight;
    this.showPaletteTooltip(tooltipLeft, tooltipCenterY, {
      title: metadata.label,
      description: metadata.description,
    });
  }

  private computeTilesetOccupancy(ts: TilesetConfig, img: HTMLImageElement): boolean[] {
    return this.computeTilesetVisibilityMap(ts, img, false);
  }

  private computeTilesetVisibility(ts: TilesetConfig, img: HTMLImageElement): boolean[] {
    return this.computeTilesetVisibilityMap(ts, img, true);
  }

  private computeTilesetVisibilityMap(
    ts: TilesetConfig,
    img: HTMLImageElement,
    allowSparseTiles: boolean,
  ): boolean[] {
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
        occupied[tileIndex] =
          isTilesetLocalTileEditorEnabled(ts, tileIndex) &&
          this.tileHasVisiblePixels(imageData, col, row, allowSparseTiles);
      }
    }

    return occupied;
  }

  private drawDisabledTileOverlays(
    ctx: CanvasRenderingContext2D,
    ts: TilesetConfig,
    scaledTile: number,
  ): void {
    if (!ts.editorTileMetadata) {
      return;
    }

    ctx.save();
    for (let tileIndex = 0; tileIndex < ts.tileCount; tileIndex += 1) {
      if (isTilesetLocalTileEditorEnabled(ts, tileIndex)) {
        continue;
      }

      const col = tileIndex % ts.columns;
      const row = Math.floor(tileIndex / ts.columns);
      const x = Math.floor(col * scaledTile);
      const y = Math.floor(row * scaledTile);
      const size = Math.floor(scaledTile);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + size - 3, y + size - 3);
      ctx.moveTo(x + size - 3, y + 3);
      ctx.lineTo(x + 3, y + size - 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private handleSpecialPaletteTileShortcut(ts: TilesetConfig, tileIndex: number): boolean {
    if (
      ts.key !== SPECIAL_TILESET_KEY ||
      tileIndex !== SPECIAL_TILE_LOCAL_INDICES.movingPlatformTile
    ) {
      return false;
    }

    this.hidePaletteTooltip();
    editorState.paletteMode = 'objects';
    editorState.selectedObjectId = MOVING_PLATFORM_OBJECT_ID;
    editorState.objectFacing = 'right';
    editorState.activeTool = 'pencil';
    this.currentObjectCategory = 'all';
    this.currentCustomObjectSubcategory = 'all';
    this.setObjectSearch('moving platform');
    this.renderObjectGrid();
    this.renderObjectFacingControls();
    this.renderTilePreview();
    this.doc.defaultView?.dispatchEvent(
      new CustomEvent(EDITOR_UI_STATE_CHANGED_EVENT, {
        detail: { objectCategory: 'all' },
      }),
    );
    this.doc.defaultView?.requestAnimationFrame(() => this.hidePaletteTooltip());
    return true;
  }

  private tileHasVisiblePixels(
    imageData: ImageData,
    tileCol: number,
    tileRow: number,
    allowSparseTiles: boolean,
  ): boolean {
    const startX = tileCol * TILE_SIZE;
    const startY = tileRow * TILE_SIZE;
    const endX = startX + TILE_SIZE;
    const endY = startY + TILE_SIZE;

    let opaquePixelCount = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const alphaIndex = (y * imageData.width + x) * 4 + 3;
        if (imageData.data[alphaIndex] > 0) {
          if (allowSparseTiles) {
            return true;
          }
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
    const visibility = this.paletteTileVisibility.get(tilesetKey);

    if (!ts || !occupancy) {
      return Array.from({ length: height }, () => Array.from({ length: width }, () => true));
    }

    return Array.from({ length: height }, (_, dy) =>
      Array.from({ length: width }, (_, dx) => {
        const tileIndex = (startRow + dy) * ts.columns + startCol + dx;
        if (width === 1 && height === 1) {
          return visibility?.[tileIndex] ?? occupancy[tileIndex] ?? true;
        }
        return occupancy[tileIndex] ?? true;
      }),
    );
  }

  private normalizeSelection(selection: TileSelection): TileSelection {
    if (this.selectionHasOccupiedCells(selection)) {
      return selection;
    }

    if (selection.width !== 1 || selection.height !== 1) {
      return selection;
    }

    const previousSelection = editorState.selection;
    if (
      previousSelection.tilesetKey === selection.tilesetKey &&
      this.selectionHasOccupiedCells(previousSelection)
    ) {
      return previousSelection;
    }

    const fallbackCell = this.findFirstVisibleTile(selection.tilesetKey);
    if (!fallbackCell) {
      return selection;
    }

    return this.createSelection(selection.tilesetKey, fallbackCell.col, fallbackCell.row, 1, 1);
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

  private selectionHasOccupiedCells(selection: TileSelection): boolean {
    return this.countOccupiedSelectionCells(selection) > 0;
  }

  private findFirstVisibleTile(tilesetKey: string): { col: number; row: number } | null {
    const ts = getTilesetByKey(tilesetKey);
    if (!ts) {
      return null;
    }

    const visibility = this.paletteTileVisibility.get(tilesetKey);
    const occupancy = this.paletteTileOccupancy.get(tilesetKey);

    for (let row = 0; row < ts.rows; row += 1) {
      for (let col = 0; col < ts.columns; col += 1) {
        const tileIndex = row * ts.columns + col;
        if (visibility?.[tileIndex] ?? occupancy?.[tileIndex]) {
          return { col, row };
        }
      }
    }

    return null;
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

  private getSelectedObjectConfig(): GameObjectConfig | null {
    if (!editorState.selectedObjectId) {
      return null;
    }

    return getEditorObjectConfigById(editorState.selectedObjectId) ?? null;
  }

  private matchesObjectCategoryFilter(objectConfig: GameObjectConfig): boolean {
    if (this.currentObjectCategory === 'all') {
      return true;
    }

    if (this.isCustomObjectCategoryFilter(this.currentObjectCategory)) {
      const customSpriteId = parseCustomSpriteObjectId(objectConfig.id);
      if (!customSpriteId) {
        return false;
      }
      if (this.currentObjectCategory === 'mine' && !isLocalCustomSpriteId(customSpriteId)) {
        return false;
      }
      return this.matchesCustomObjectSubcategory(objectConfig);
    }

    if (this.currentObjectCategory === 'interactive') {
      return objectConfig.category === 'interactive' || objectConfig.category === 'platform';
    }

    return objectConfig.category === this.currentObjectCategory;
  }

  private matchesObjectSearchFilter(objectConfig: GameObjectConfig): boolean {
    if (!this.currentObjectSearch) {
      return true;
    }

    const searchableText = [
      objectConfig.name,
      objectConfig.id,
      objectConfig.description,
      objectConfig.category,
      this.getCustomObjectSubcategory(objectConfig) ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return searchableText.includes(this.currentObjectSearch);
  }

  private isCustomObjectCategoryFilter(category: string): boolean {
    return category === 'custom' || category === 'mine';
  }

  private normalizeCustomObjectSubcategory(value: string | undefined): CustomObjectSubcategory {
    return CUSTOM_OBJECT_SUBCATEGORIES.includes(value as CustomObjectSubcategory)
      ? value as CustomObjectSubcategory
      : 'all';
  }

  private matchesCustomObjectSubcategory(objectConfig: GameObjectConfig): boolean {
    if (this.currentCustomObjectSubcategory === 'all') {
      return true;
    }

    return this.getCustomObjectSubcategory(objectConfig) === this.currentCustomObjectSubcategory;
  }

  private getCustomObjectSubcategory(objectConfig: GameObjectConfig): CustomObjectKindSubcategory | null {
    const sprite = getCustomSpriteDefinitionByObjectId(objectConfig.id);
    if (sprite) {
      return sprite.kind;
    }

    if (!parseCustomSpriteObjectId(objectConfig.id)) {
      return null;
    }

    if (objectConfig.category === 'collectible') {
      return 'collectible';
    }
    if (objectConfig.interaction === 'pushable') {
      return 'pushable';
    }
    if (objectConfig.category === 'platform') {
      return 'solid';
    }
    return 'decoration';
  }

  private shouldFlipSelectedObject(objectConfig: GameObjectConfig): boolean {
    if (!objectConfig.facingDirection) {
      return false;
    }

    return objectConfig.facingDirection !== editorState.objectFacing;
  }

  private getObjectPreviewSourceSize(objectConfig: GameObjectConfig): { width: number; height: number } {
    // Palette previews should show the full sprite art, not the tighter placement bounds.
    return {
      width: objectConfig.frameWidth,
      height: objectConfig.frameHeight,
    };
  }

  private drawObjectFrame(
    context: CanvasRenderingContext2D,
    objectConfig: GameObjectConfig,
    image: HTMLImageElement,
    frame: number,
    destX: number,
    destY: number,
    destWidth: number,
    destHeight: number,
    flipX: boolean,
  ): void {
    const sourceRect = getObjectFrameSourceRect(
      objectConfig,
      frame,
      image.naturalWidth || image.width || objectConfig.frameWidth,
    );
    context.save();

    if (flipX) {
      context.translate(destX + destWidth, destY);
      context.scale(-1, 1);
      context.drawImage(
        image,
        sourceRect.sx,
        sourceRect.sy,
        sourceRect.sw,
        sourceRect.sh,
        0,
        0,
        destWidth,
        destHeight,
      );
    } else {
      context.drawImage(
        image,
        sourceRect.sx,
        sourceRect.sy,
        sourceRect.sw,
        sourceRect.sh,
        destX,
        destY,
        destWidth,
        destHeight,
      );
    }

    context.restore();
  }
}
