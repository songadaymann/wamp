import {
  TILESETS,
  TILE_SIZE,
  GAME_OBJECTS,
  editorState,
  getTilesetByKey,
  type TileSelection,
  type TilesetConfig,
  type ToolName,
  type LayerName,
  type PaletteMode,
} from '../config';
import type { RoomVersionRecord } from '../persistence/roomModel';

let paletteImages: Map<string, HTMLImageElement> = new Map();
let paletteTileOccupancy: Map<string, boolean[]> = new Map();
let currentPaletteScale = 1;
let currentObjectCategory: string = 'all';

const MIN_SELECTION_OPAQUE_PIXELS = 24;

// Palette drag state
let paletteDragStart: { col: number; row: number } | null = null;
let paletteDragging = false;
let activeHistoryTargetVersion: number | null = null;

type EditorHistoryState = {
  roomId: string;
  claimerDisplayName: string | null;
  claimedAt: string | null;
  canRevert: boolean;
  canPublish: boolean;
  versions: RoomVersionRecord[];
};

const HISTORY_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function setupUI(game: Phaser.Game): void {
  loadPaletteImages();
  setupToolButtons();
  setupLayerButtons();
  setupTilesetSelector();
  setupBackgroundSelector();
  setupPaletteModeTabs();
  setupObjectCategoryTabs();
  setupRoomHistoryModal(game);
  setupBottomBarButtons(game);
  setupKeyboardShortcutPassthrough();
  renderObjectGrid();

  // Listen for programmatic updates
  window.addEventListener('tileset-changed', () => renderPalette());
  window.addEventListener('tile-selected', () => renderTilePreview());
}

function getEditorScene(game: Phaser.Game): any | null {
  try {
    return game.scene.getScene('EditorScene') as any;
  } catch {
    return null;
  }
}

function getHistoryModalElements(): {
  modal: HTMLElement | null;
  meta: HTMLElement | null;
  list: HTMLElement | null;
  error: HTMLElement | null;
} {
  return {
    modal: document.getElementById('room-history-modal'),
    meta: document.getElementById('room-history-meta'),
    list: document.getElementById('room-history-list'),
    error: document.getElementById('room-history-error'),
  };
}

function getEditorStatusText(): string {
  const statusEl = document.getElementById('room-save-status');
  return statusEl?.textContent?.trim() || '';
}

function formatHistoryTimestamp(value: string | null): string {
  if (!value) {
    return 'Unknown time';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return HISTORY_TIME_FORMATTER.format(date);
}

function setRoomHistoryError(message: string | null): void {
  const { error } = getHistoryModalElements();
  if (!error) return;

  if (!message) {
    error.textContent = '';
    error.classList.add('hidden');
    return;
  }

  error.textContent = message;
  error.classList.remove('hidden');
}

function closeRoomHistoryModal(): void {
  const { modal, list } = getHistoryModalElements();
  if (!modal || !list) return;

  activeHistoryTargetVersion = null;
  setRoomHistoryError(null);
  list.replaceChildren();
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function setupRoomHistoryModal(game: Phaser.Game): void {
  const modal = document.getElementById('room-history-modal');
  const closeBtn = document.getElementById('btn-room-history-close');

  closeBtn?.addEventListener('click', () => {
    closeRoomHistoryModal();
  });

  modal?.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeRoomHistoryModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    const { modal: historyModal } = getHistoryModalElements();
    if (!historyModal || historyModal.classList.contains('hidden')) {
      return;
    }

    closeRoomHistoryModal();
  });

  window.addEventListener('resize', () => {
    const { modal: historyModal } = getHistoryModalElements();
    if (!historyModal || historyModal.classList.contains('hidden')) {
      return;
    }

    void renderRoomHistoryModal(game);
  });
}

async function openRoomHistoryModal(game: Phaser.Game): Promise<void> {
  const editorScene = getEditorScene(game);
  if (!editorScene?.getHistoryState || !game.scene.isActive('EditorScene')) {
    return;
  }

  const { modal } = getHistoryModalElements();
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  activeHistoryTargetVersion = null;
  setRoomHistoryError(null);
  await renderRoomHistoryModal(game);
}

async function renderRoomHistoryModal(game: Phaser.Game): Promise<void> {
  const { modal, meta, list } = getHistoryModalElements();
  if (!modal || !meta || !list || modal.classList.contains('hidden')) {
    return;
  }

  const editorScene = getEditorScene(game);
  if (!editorScene?.getHistoryState || !game.scene.isActive('EditorScene')) {
    closeRoomHistoryModal();
    return;
  }

  const state = editorScene.getHistoryState() as EditorHistoryState;
  const latestVersion = state.versions.reduce((max, version) => Math.max(max, version.version), 0);
  const metaParts = [
    `Room ${state.roomId}`,
    `${state.versions.length} version${state.versions.length === 1 ? '' : 's'}`,
  ];

  if (state.claimerDisplayName) {
    const claimLine = state.claimedAt
      ? `Claimed by ${state.claimerDisplayName} on ${formatHistoryTimestamp(state.claimedAt)}`
      : `Claimed by ${state.claimerDisplayName}`;
    metaParts.push(claimLine);
  } else {
    metaParts.push('Unclaimed room');
  }

  if (!state.canPublish) {
    metaParts.push('Minted lock active');
  }

  meta.textContent = metaParts.join(' | ');
  list.replaceChildren();

  if (state.versions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-version-empty';
    empty.textContent = 'No published versions yet.';
    list.appendChild(empty);
    return;
  }

  const versionsNewestFirst = [...state.versions].sort((a, b) => b.version - a.version);

  for (const version of versionsNewestFirst) {
    const row = document.createElement('div');
    row.className = 'history-version-row';

    const copy = document.createElement('div');
    copy.className = 'history-version-copy';

    const titleLine = document.createElement('div');
    titleLine.className = 'history-version-line';

    const label = document.createElement('div');
    label.className = 'history-version-label';
    label.textContent = `v${version.version}`;
    titleLine.appendChild(label);

    if (version.version === latestVersion) {
      const badge = document.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = 'Latest';
      titleLine.appendChild(badge);
    }

    if (version.revertedFromVersion !== null) {
      const badge = document.createElement('span');
      badge.className = 'history-version-badge';
      badge.textContent = `Revert of v${version.revertedFromVersion}`;
      titleLine.appendChild(badge);
    }

    const metaLine = document.createElement('div');
    metaLine.className = 'history-version-meta';
    const lineParts = [`Published ${formatHistoryTimestamp(version.createdAt)}`];
    if (version.publishedByDisplayName) {
      lineParts.push(`by ${version.publishedByDisplayName}`);
    }
    metaLine.textContent = lineParts.join(' ');

    copy.appendChild(titleLine);
    copy.appendChild(metaLine);
    row.appendChild(copy);

    if (state.canRevert && version.version < latestVersion) {
      const button = document.createElement('button');
      button.className = 'bar-btn bar-btn-small';
      button.textContent =
        activeHistoryTargetVersion === version.version ? 'Reverting...' : 'Revert';
      button.disabled = activeHistoryTargetVersion !== null;
      button.addEventListener('click', () => {
        void handleRoomHistoryRevert(game, version.version);
      });
      row.appendChild(button);
    }

    list.appendChild(row);
  }
}

async function handleRoomHistoryRevert(game: Phaser.Game, targetVersion: number): Promise<void> {
  const editorScene = getEditorScene(game);
  if (!editorScene?.revertToVersion || !game.scene.isActive('EditorScene')) {
    return;
  }

  activeHistoryTargetVersion = targetVersion;
  setRoomHistoryError(null);
  await renderRoomHistoryModal(game);

  const result = await editorScene.revertToVersion(targetVersion);

  activeHistoryTargetVersion = null;

  if (!result) {
    const statusMessage = getEditorStatusText() || `Revert to v${targetVersion} failed.`;
    setRoomHistoryError(statusMessage);
    await renderRoomHistoryModal(game);
    return;
  }

  setRoomHistoryError(null);
  await renderRoomHistoryModal(game);
}

// ══════════════════════════════════════
// PALETTE IMAGE LOADING
// ══════════════════════════════════════

function loadPaletteImages(): void {
  let loadedCount = 0;

  for (const ts of TILESETS) {
    const img = new Image();
    img.src = ts.path;
    img.onload = () => {
      paletteImages.set(ts.key, img);
      paletteTileOccupancy.set(ts.key, computeTilesetOccupancy(ts, img));
      loadedCount++;
      if (loadedCount === TILESETS.length) {
        renderPalette();
        renderTilePreview();
      }
    };
  }
}

// ══════════════════════════════════════
// PALETTE RENDERING (dynamic scale to fit sidebar)
// ══════════════════════════════════════

function renderPalette(): void {
  const canvas = document.getElementById('palette-canvas') as HTMLCanvasElement;
  const container = document.getElementById('palette-container');
  if (!canvas || !container) return;

  const ts = getTilesetByKey(editorState.selectedTilesetKey);
  const img = paletteImages.get(editorState.selectedTilesetKey);
  if (!ts || !img) return;

  // Calculate scale to fit container width
  const availableWidth = container.clientWidth - 4; // small margin
  const scale = Math.max(1, availableWidth / ts.imageWidth);
  currentPaletteScale = scale;

  const scaledWidth = Math.floor(ts.imageWidth * scale);
  const scaledHeight = Math.floor(ts.imageHeight * scale);
  const scaledTile = TILE_SIZE * scale;

  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  canvas.style.width = `${scaledWidth}px`;
  canvas.style.height = `${scaledHeight}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Draw tileset
  ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

  // Draw grid
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

  // Highlight selection rectangle
  const sel = editorState.selection;
  if (sel.tilesetKey === ts.key) {
    ctx.strokeStyle = '#5577ff';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(85, 119, 255, 0.15)';

    const sx = Math.floor(sel.startCol * scaledTile) + 1;
    const sy = Math.floor(sel.startRow * scaledTile) + 1;
    const sw = Math.floor(sel.width * scaledTile) - 2;
    const sh = Math.floor(sel.height * scaledTile) - 2;

    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeRect(sx, sy, sw, sh);
    drawSelectionEmptyCellOverlay(ctx, sel, scaledTile, scaledTile, sx - 1, sy - 1);
  }

  // Setup palette mouse handlers (only once, re-binds via closure)
  canvas.onmousedown = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / scaledTile);
    const row = Math.floor(y / scaledTile);

    if (col >= 0 && col < ts.columns && row >= 0 && row < ts.rows) {
      paletteDragStart = { col, row };
      paletteDragging = false;

      // Immediately set single tile selection
      updateSelection(ts.key, col, row, col, row);
    }
  };

  canvas.onmousemove = (e: MouseEvent) => {
    if (!paletteDragStart) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.min(ts.columns - 1, Math.max(0, Math.floor(x / scaledTile)));
    const row = Math.min(ts.rows - 1, Math.max(0, Math.floor(y / scaledTile)));

    if (col !== paletteDragStart.col || row !== paletteDragStart.row) {
      paletteDragging = true;
    }

    updateSelection(ts.key, paletteDragStart.col, paletteDragStart.row, col, row);
  };

  canvas.onmouseup = () => {
    paletteDragStart = null;
    paletteDragging = false;
  };

  canvas.onmouseleave = () => {
    if (paletteDragStart) {
      paletteDragStart = null;
      paletteDragging = false;
    }
  };

  // Remove old onclick (we use mousedown/up now)
  canvas.onclick = null;
}

function updateSelection(
  tilesetKey: string,
  col1: number, row1: number,
  col2: number, row2: number
): void {
  const startCol = Math.min(col1, col2);
  const startRow = Math.min(row1, row2);
  const endCol = Math.max(col1, col2);
  const endRow = Math.max(row1, row2);

  const ts = getTilesetByKey(tilesetKey);
  if (!ts) return;

  const nextSelection: TileSelection = {
    tilesetKey,
    startCol,
    startRow,
    width: endCol - startCol + 1,
    height: endRow - startRow + 1,
    occupiedMask: buildSelectionOccupiedMask(
      tilesetKey,
      startCol,
      startRow,
      endCol - startCol + 1,
      endRow - startRow + 1,
    ),
  };
  editorState.selection = nextSelection;

  editorState.selectedTileGid = getPrimarySelectionGid(nextSelection, ts);

  // Update selection info label
  const infoEl = document.getElementById('selection-info');
  if (infoEl) {
    const occupiedCount = countOccupiedSelectionCells(nextSelection);
    const totalCells = nextSelection.width * nextSelection.height;

    if (totalCells === 1) {
      infoEl.textContent = occupiedCount === 0 ? '(empty)' : '';
    } else if (occupiedCount === totalCells) {
      infoEl.textContent = `(${nextSelection.width}x${nextSelection.height})`;
    } else {
      infoEl.textContent = `(${nextSelection.width}x${nextSelection.height}, ${occupiedCount} tiles)`;
    }
  }

  renderPalette();
  renderTilePreview();
}

function renderTilePreview(): void {
  const canvas = document.getElementById('tile-preview') as HTMLCanvasElement;
  if (!canvas) return;

  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // If in object mode, show selected object preview
  if (editorState.paletteMode === 'objects' && editorState.selectedObjectId) {
    const obj = GAME_OBJECTS.find(o => o.id === editorState.selectedObjectId);
    if (obj) {
      const objImg = new Image();
      objImg.src = obj.path;
      objImg.onload = () => {
        canvas.width = 64;
        canvas.height = 64;
        ctx.clearRect(0, 0, 64, 64);

        // Draw first frame only, scaled to fit
        const previewScale = Math.min(64 / obj.frameWidth, 64 / obj.frameHeight);
        const drawW = Math.floor(obj.frameWidth * previewScale);
        const drawH = Math.floor(obj.frameHeight * previewScale);
        const offsetX = Math.floor((64 - drawW) / 2);
        const offsetY = Math.floor((64 - drawH) / 2);

        ctx.drawImage(
          objImg,
          0, 0,
          obj.frameWidth, obj.frameHeight,
          offsetX, offsetY,
          drawW, drawH
        );
      };
      return;
    }
  }

  const sel = editorState.selection;
  const ts = getTilesetByKey(sel.tilesetKey);
  const img = paletteImages.get(sel.tilesetKey);
  if (!ts || !img) return;

  // Scale preview to fit 64x64 while maintaining aspect ratio
  const selPxW = sel.width * TILE_SIZE;
  const selPxH = sel.height * TILE_SIZE;
  const previewScale = Math.min(64 / selPxW, 64 / selPxH);
  const drawW = Math.floor(selPxW * previewScale);
  const drawH = Math.floor(selPxH * previewScale);

  canvas.width = 64;
  canvas.height = 64;
  ctx.clearRect(0, 0, 64, 64);

  // Draw the selection region
  const offsetX = Math.floor((64 - drawW) / 2);
  const offsetY = Math.floor((64 - drawH) / 2);

  ctx.drawImage(
    img,
    sel.startCol * TILE_SIZE, sel.startRow * TILE_SIZE,
    selPxW, selPxH,
    offsetX, offsetY,
    drawW, drawH
  );

  drawSelectionEmptyCellOverlay(
    ctx,
    sel,
    drawW / sel.width,
    drawH / sel.height,
    offsetX,
    offsetY,
  );
}

// ══════════════════════════════════════
// TOOL BUTTONS
// ══════════════════════════════════════

function setupToolButtons(): void {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = (btn as HTMLElement).dataset.tool as ToolName;
      editorState.activeTool = tool;

      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ══════════════════════════════════════
// LAYER BUTTONS
// ══════════════════════════════════════

function setupLayerButtons(): void {
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = (btn as HTMLElement).dataset.layer as LayerName;
      editorState.activeLayer = layer;

      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ══════════════════════════════════════
// BACKGROUND SELECTOR
// ══════════════════════════════════════

function setupBackgroundSelector(): void {
  const select = document.getElementById('background-select') as HTMLSelectElement;
  if (!select) return;

  select.addEventListener('change', () => {
    editorState.selectedBackground = select.value;
    window.dispatchEvent(new Event('background-changed'));
  });
}

// ══════════════════════════════════════
// PALETTE MODE TABS (Tiles / Objects)
// ══════════════════════════════════════

function setupPaletteModeTabs(): void {
  document.querySelectorAll('.palette-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = (tab as HTMLElement).dataset.mode as PaletteMode;
      editorState.paletteMode = mode;

      // Update tab active state
      document.querySelectorAll('.palette-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide appropriate sections
      const tilesetSection = document.getElementById('tileset-section');
      const tilePaletteSection = document.getElementById('tile-palette-section');
      const objectPaletteSection = document.getElementById('object-palette-section');

      if (mode === 'tiles') {
        tilesetSection?.classList.remove('hidden');
        tilePaletteSection?.classList.remove('hidden');
        objectPaletteSection?.classList.add('hidden');
        editorState.selectedObjectId = null;
      } else {
        tilesetSection?.classList.add('hidden');
        tilePaletteSection?.classList.add('hidden');
        objectPaletteSection?.classList.remove('hidden');
        // Auto-select pencil tool for object placement
        editorState.activeTool = 'pencil';
        document.querySelectorAll('.tool-btn').forEach(b => {
          b.classList.toggle('active', (b as HTMLElement).dataset.tool === 'pencil');
        });
      }

      renderTilePreview();
    });
  });
}

// ══════════════════════════════════════
// OBJECT CATEGORY TABS
// ══════════════════════════════════════

function setupObjectCategoryTabs(): void {
  document.querySelectorAll('.obj-cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentObjectCategory = (tab as HTMLElement).dataset.category || 'all';

      document.querySelectorAll('.obj-cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      renderObjectGrid();
    });
  });
}

// ══════════════════════════════════════
// OBJECT GRID
// ══════════════════════════════════════

function renderObjectGrid(): void {
  const grid = document.getElementById('object-grid');
  if (!grid) return;

  grid.innerHTML = '';

  const filtered = currentObjectCategory === 'all'
    ? GAME_OBJECTS
    : GAME_OBJECTS.filter(obj => {
        // Group platform and interactive into "other" category
        if (currentObjectCategory === 'interactive') {
          return obj.category === 'interactive' || obj.category === 'platform';
        }
        return obj.category === currentObjectCategory;
      });

  for (const obj of filtered) {
    const item = document.createElement('div');
    item.className = 'object-item';
    if (editorState.selectedObjectId === obj.id) {
      item.classList.add('active');
    }
    item.dataset.objectId = obj.id;

    item.addEventListener('mouseenter', (e) => {
      showObjectTooltip(e.currentTarget as HTMLElement, `${obj.name} — ${obj.description}`);
    });
    item.addEventListener('mouseleave', hideObjectTooltip);

    // Create image showing just the first frame
    const img = document.createElement('img');
    img.src = obj.path;
    // For spritesheets, we need to clip to first frame using a canvas
    if (obj.frameCount > 1) {
      const canvas = document.createElement('canvas');
      canvas.width = obj.frameWidth;
      canvas.height = obj.frameHeight;
      const srcImg = new Image();
      srcImg.src = obj.path;
      srcImg.onload = () => {
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(srcImg, 0, 0, obj.frameWidth, obj.frameHeight, 0, 0, obj.frameWidth, obj.frameHeight);
        img.src = canvas.toDataURL();
      };
    }

    const label = document.createElement('div');
    label.className = 'object-item-label';
    label.textContent = obj.name;

    item.appendChild(img);
    item.appendChild(label);

    item.addEventListener('click', () => {
      editorState.selectedObjectId = obj.id;

      // Update active state
      document.querySelectorAll('.object-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');

      // Switch to pencil tool
      editorState.activeTool = 'pencil';
      document.querySelectorAll('.tool-btn').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.tool === 'pencil');
      });

      renderTilePreview();
    });

    grid.appendChild(item);
  }
}

// ══════════════════════════════════════
// OBJECT TOOLTIP
// ══════════════════════════════════════

let objectTooltipEl: HTMLDivElement | null = null;

function getObjectTooltip(): HTMLDivElement {
  if (!objectTooltipEl) {
    objectTooltipEl = document.createElement('div');
    objectTooltipEl.id = 'object-tooltip';
    document.body.appendChild(objectTooltipEl);
  }
  return objectTooltipEl;
}

function showObjectTooltip(anchor: HTMLElement, text: string): void {
  const tip = getObjectTooltip();
  tip.textContent = text;
  const rect = anchor.getBoundingClientRect();
  tip.style.left = `${rect.right + 8}px`;
  tip.style.top = `${rect.top + rect.height / 2}px`;
  tip.style.transform = 'translateY(-50%)';
  tip.classList.add('visible');
}

function hideObjectTooltip(): void {
  objectTooltipEl?.classList.remove('visible');
}

// ══════════════════════════════════════
// TILESET SELECTOR
// ══════════════════════════════════════

function setupTilesetSelector(): void {
  const select = document.getElementById('tileset-select') as HTMLSelectElement;
  if (!select) return;

  select.addEventListener('change', () => {
    editorState.selectedTilesetKey = select.value;
    const ts = getTilesetByKey(select.value);
    if (ts) {
      updateSelection(ts.key, 0, 0, 0, 0);
    }
    renderPalette();
    renderTilePreview();
  });
}

function computeTilesetOccupancy(ts: TilesetConfig, img: HTMLImageElement): boolean[] {
  const canvas = document.createElement('canvas');
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
      occupied[tileIndex] = tileHasVisiblePixels(imageData, col, row);
    }
  }

  return occupied;
}

function tileHasVisiblePixels(
  imageData: ImageData,
  tileCol: number,
  tileRow: number,
): boolean {
  const startX = tileCol * TILE_SIZE;
  const startY = tileRow * TILE_SIZE;
  const endX = startX + TILE_SIZE;
  const endY = startY + TILE_SIZE;

  let opaquePixelCount = 0;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const alphaIndex = ((y * imageData.width) + x) * 4 + 3;
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

function buildSelectionOccupiedMask(
  tilesetKey: string,
  startCol: number,
  startRow: number,
  width: number,
  height: number,
): boolean[][] {
  const ts = getTilesetByKey(tilesetKey);
  const occupancy = paletteTileOccupancy.get(tilesetKey);

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

function countOccupiedSelectionCells(selection: TileSelection): number {
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

function getPrimarySelectionGid(selection: TileSelection, ts: TilesetConfig): number {
  for (let dy = 0; dy < selection.height; dy++) {
    for (let dx = 0; dx < selection.width; dx++) {
      if (!selection.occupiedMask[dy]?.[dx]) continue;
      const col = selection.startCol + dx;
      const row = selection.startRow + dy;
      return ts.firstGid + row * ts.columns + col;
    }
  }

  return -1;
}

function drawSelectionEmptyCellOverlay(
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
      if (selection.occupiedMask[dy]?.[dx]) continue;

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

// ══════════════════════════════════════
// BOTTOM BAR BUTTONS
// ══════════════════════════════════════

function setupBottomBarButtons(game: Phaser.Game): void {
  const worldPlayBtn = document.getElementById('btn-world-play');
  const worldEditBtn = document.getElementById('btn-world-edit');
  const worldBuildBtn = document.getElementById('btn-world-build');
  const worldJumpBtn = document.getElementById('btn-world-jump');
  const worldZoomInBtn = document.getElementById('btn-world-zoom-in');
  const worldZoomOutBtn = document.getElementById('btn-world-zoom-out');
  const worldJumpInput = document.getElementById('world-jump-input') as HTMLInputElement | null;
  const backToWorldBtn = document.getElementById('btn-back-to-world');
  const playBtn = document.getElementById('btn-test-play');
  const saveBtn = document.getElementById('btn-save-draft');
  const publishBtn = document.getElementById('btn-publish-room');
  const historyBtn = document.getElementById('btn-room-history');
  const fitBtn = document.getElementById('btn-fit-screen');

  worldPlayBtn?.addEventListener('click', () => {
    const overworldScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldScene?.playSelectedRoom) {
      overworldScene.playSelectedRoom();
    }
  });

  worldEditBtn?.addEventListener('click', () => {
    const overworldScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldScene?.editSelectedRoom) {
      overworldScene.editSelectedRoom();
    }
  });

  worldBuildBtn?.addEventListener('click', () => {
    const overworldScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldScene?.buildSelectedRoom) {
      overworldScene.buildSelectedRoom();
    }
  });

  worldZoomInBtn?.addEventListener('click', () => {
    const overworldScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldScene?.zoomIn) {
      overworldScene.zoomIn();
    }
  });

  worldZoomOutBtn?.addEventListener('click', () => {
    const overworldScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldScene?.zoomOut) {
      overworldScene.zoomOut();
    }
  });

  const handleWorldJump = () => {
    const overworldScene = game.scene.getScene('OverworldPlayScene') as any;
    if (!game.scene.isActive('OverworldPlayScene') || !overworldScene?.jumpToCoordinates || !worldJumpInput) {
      return;
    }

    const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(worldJumpInput.value);
    if (!match) return;

    void overworldScene.jumpToCoordinates({
      x: Number(match[1]),
      y: Number(match[2]),
    });
  };

  worldJumpBtn?.addEventListener('click', handleWorldJump);
  worldJumpInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handleWorldJump();
    }
  });

  playBtn?.addEventListener('click', () => {
    closeRoomHistoryModal();
    const editorScene = game.scene.getScene('EditorScene') as any;
    if (editorScene?.startPlayMode) {
      editorScene.startPlayMode();
    }
  });

  backToWorldBtn?.addEventListener('click', () => {
    closeRoomHistoryModal();
    const editorScene = game.scene.getScene('EditorScene') as any;
    if (game.scene.isActive('EditorScene') && editorScene?.returnToWorld) {
      editorScene.returnToWorld();
      return;
    }

    const overworldPlayScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldPlayScene?.returnToWorld) {
      overworldPlayScene.returnToWorld();
    }
  });

  saveBtn?.addEventListener('click', async () => {
    const editorScene = game.scene.getScene('EditorScene') as any;
    if (editorScene?.saveDraft) {
      await editorScene.saveDraft(true);
    }
  });

  publishBtn?.addEventListener('click', async () => {
    const editorScene = game.scene.getScene('EditorScene') as any;
    if (editorScene?.publishRoom) {
      await editorScene.publishRoom();
    }
  });

  historyBtn?.addEventListener('click', () => {
    void openRoomHistoryModal(game);
  });

  fitBtn?.addEventListener('click', () => {
    const editorScene = game.scene.getScene('EditorScene') as any;
    if (game.scene.isActive('EditorScene') && editorScene?.fitToScreen) {
      editorScene.fitToScreen();
      return;
    }

    const overworldPlayScene = game.scene.getScene('OverworldPlayScene') as any;
    if (game.scene.isActive('OverworldPlayScene') && overworldPlayScene?.fitLoadedWorld) {
      overworldPlayScene.fitLoadedWorld();
    }
  });
}

// ══════════════════════════════════════
// KEYBOARD SHORTCUT PASSTHROUGH
// ══════════════════════════════════════

function setupKeyboardShortcutPassthrough(): void {
  document.getElementById('sidebar')?.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName !== 'SELECT') {
      e.preventDefault();
    }
  });
}
