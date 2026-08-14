import Phaser from 'phaser';
import { editorState } from '../../config';
import {
  buildCustomSpriteObjectId,
  getCustomSpriteKindLabel,
  type CustomSpriteDefinition,
  type CustomSpriteKind,
  type CustomSpriteSize,
} from '../../customSprites/model';
import { canCustomSpriteBecomeRoomTile } from '../../customTiles/model';
import {
  CUSTOM_SPRITE_ACCOUNT_LIMIT,
  CUSTOM_SPRITE_REMIX_REQUESTED_EVENT,
  CUSTOM_SPRITE_USE_REQUESTED_EVENT,
  type CustomSpriteCatalogEntry,
} from '../../customSprites/catalog';
import {
  CustomSpriteCatalogApiError,
  deleteCommunityCustomSprite,
} from '../../customSprites/catalogClient';
import { deleteCustomSpriteIfUnused } from '../../customSprites/deletion';
import { isCustomSpriteUsedInLocalRoomStorage } from '../../customSprites/localUsage';
import { loadCustomSpriteUsage } from '../../customSprites/usageClient';
import {
  CUSTOM_SPRITES_CHANGED_EVENT,
  getCustomSpriteDataUrl,
  getCustomSpriteDefinition,
  getCurrentCustomSpriteOwnerUserId,
  getLocalCustomSpriteMetadata,
  listLocalCustomSpriteDefinitions,
  removeLocalCustomSprite,
  refreshCustomSpriteTexture,
  registerCustomSprite,
} from '../../customSprites/registry';
import { queueCustomSpriteSync, refreshOwnedCustomSprites } from '../../customSprites/sync';
import { EDITOR_UI_STATE_CHANGED_EVENT } from '../../scenes/editor/uiEvents';
import { syncGameKeyboardFocus } from '../keyboardFocus';
import { withActiveEditorScene } from './sceneBridge';

type SpritePaintTool = 'pencil' | 'eraser' | 'fill';
type SpritePaintDragMode = 'paint' | 'erase';
type SpritePixelBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};
type SpriteClipboard = {
  size: CustomSpriteSize;
  pixels: Array<string | null>;
  bounds: SpritePixelBounds;
};

const SPRITE_PRESET_COLORS = [
  '#fff3db',
  '#18161c',
  '#f84f4f',
  '#ffb347',
  '#ffe86b',
  '#7bd66f',
  '#4cc3ff',
  '#b88cff',
  '#ff78b4',
  '#8f6a4a',
];
const SPRITE_EDITOR_CHECKER_LIGHT = '#f7f7f7';
const SPRITE_EDITOR_CHECKER_DARK = '#cfcfcf';
const SPRITE_HISTORY_LIMIT = 80;
const SPRITE_PALETTE_STORAGE_KEY = 'wamp_sprite_editor_manual_palette_v1';
const SPRITE_PALETTE_MAX_COLORS = SPRITE_PRESET_COLORS.length;

function getSpriteSize(value: string | undefined): CustomSpriteSize {
  return value === '32' ? 32 : 16;
}

function createSpriteId(): string {
  return `sprite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampSpriteName(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 32) : 'My Sprite';
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizeHexColor(value: string | null | undefined): string | null {
  return value && isValidHexColor(value) ? value.toLowerCase() : null;
}

function loadManualPaletteColors(): string[] {
  try {
    const raw = window.localStorage.getItem(SPRITE_PALETTE_STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(values)) {
      return [];
    }

    return Array.from(
      new Set(
        values
          .map((value) => normalizeHexColor(typeof value === 'string' ? value : null))
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, SPRITE_PALETTE_MAX_COLORS);
  } catch {
    return [];
  }
}

function saveManualPaletteColors(colors: readonly string[]): void {
  try {
    window.localStorage.setItem(SPRITE_PALETTE_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // The in-memory palette still works if browser storage is unavailable.
  }
}

function getSpritePixelBounds(values: readonly (string | null)[], spriteSize: CustomSpriteSize): SpritePixelBounds | null {
  let minX: number = spriteSize;
  let minY: number = spriteSize;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < values.length; index += 1) {
    if (!values[index]) {
      continue;
    }

    const x = index % spriteSize;
    const y = Math.floor(index / spriteSize);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function setupCustomSpriteEditor(
  game: Phaser.Game,
  doc: Document = document,
): void {
  const modeButton = doc.getElementById('btn-editor-sprite-mode') as HTMLButtonElement | null;
  const overlay = doc.getElementById('editor-sprite-overlay');
  const canvas = doc.getElementById('editor-sprite-canvas') as HTMLCanvasElement | null;
  const previewCanvas = doc.getElementById('editor-sprite-preview') as HTMLCanvasElement | null;
  const nameInput = doc.getElementById('editor-sprite-name') as HTMLInputElement | null;
  const kindSelect = doc.getElementById('editor-sprite-kind') as HTMLSelectElement | null;
  const colorInput = doc.getElementById('editor-sprite-color') as HTMLInputElement | null;
  const statusEl = doc.getElementById('editor-sprite-status');
  const kindHelp = doc.getElementById('editor-sprite-kind-help');
  const kindChoiceButtons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>('[data-editor-sprite-kind-choice]')
  );
  const sizeButtons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>('[data-editor-sprite-size]')
  );
  const toolButtons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>('[data-editor-sprite-tool]')
  );
  const swatchGrid = doc.getElementById('editor-sprite-swatches');
  const clearButton = doc.getElementById('btn-editor-sprite-clear') as HTMLButtonElement | null;
  const undoButton = doc.getElementById('btn-editor-sprite-undo') as HTMLButtonElement | null;
  const copyButton = doc.getElementById('btn-editor-sprite-copy') as HTMLButtonElement | null;
  const cutButton = doc.getElementById('btn-editor-sprite-cut') as HTMLButtonElement | null;
  const pasteButton = doc.getElementById('btn-editor-sprite-paste') as HTMLButtonElement | null;
  const saveButton = doc.getElementById('btn-editor-sprite-save') as HTMLButtonElement | null;
  const closeButton = doc.getElementById('btn-editor-sprite-close') as HTMLButtonElement | null;
  const newButton = doc.getElementById('btn-editor-sprite-new') as HTMLButtonElement | null;
  const libraryList = doc.getElementById('editor-sprite-library-list');

  if (!modeButton || !overlay || !canvas) {
    return;
  }

  let size: CustomSpriteSize = 16;
  let pixels: Array<string | null> = Array.from({ length: size * size }, () => null);
  let activeTool: SpritePaintTool = 'pencil';
  let dragMode: SpritePaintDragMode | null = null;
  let isPointerDown = false;
  let editingSpriteId: string | null = null;
  let remixedFromSpriteId: string | null = null;
  let saveAfterUseAsChoice = false;
  let spriteClipboard: SpriteClipboard | null = null;
  let clipboardPlacementActive = false;
  let clipboardHoverCell: { x: number; y: number } | null = null;
  let lastCanvasCell: { x: number; y: number } | null = null;
  let manualPaletteColors = loadManualPaletteColors();
  let undoStack: Array<Array<string | null>> = [];
  let pendingUndoSnapshot: Array<string | null> | null = null;

  canvas.tabIndex = 0;

  const setStatus = (message: string, tone: 'neutral' | 'error' = 'neutral') => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  const syncCommandButtons = (): void => {
    if (undoButton) {
      undoButton.disabled = undoStack.length === 0;
    }
    if (pasteButton) {
      pasteButton.disabled = spriteClipboard === null;
      pasteButton.classList.toggle('active', clipboardPlacementActive);
      pasteButton.setAttribute('aria-pressed', clipboardPlacementActive ? 'true' : 'false');
    }
  };

  const createEmptyPixels = (spriteSize: CustomSpriteSize = size): Array<string | null> =>
    Array.from({ length: spriteSize * spriteSize }, () => null);

  const pixelsAreEqual = (
    first: readonly (string | null)[],
    second: readonly (string | null)[],
  ): boolean => {
    if (first.length !== second.length) {
      return false;
    }

    return first.every((value, index) => value === second[index]);
  };

  const pushUndoSnapshot = (snapshot: Array<string | null>): boolean => {
    if (pixelsAreEqual(snapshot, pixels)) {
      return false;
    }

    undoStack.push(snapshot);
    if (undoStack.length > SPRITE_HISTORY_LIMIT) {
      undoStack = undoStack.slice(-SPRITE_HISTORY_LIMIT);
    }
    syncCommandButtons();
    return true;
  };

  const beginPixelEdit = (): void => {
    pendingUndoSnapshot = [...pixels];
  };

  const commitPixelEdit = (): void => {
    const snapshot = pendingUndoSnapshot;
    pendingUndoSnapshot = null;
    if (snapshot) {
      pushUndoSnapshot(snapshot);
    }
  };

  const replacePixelsWithUndo = (
    nextPixels: Array<string | null>,
    statusMessage: string,
    noChangeMessage: string,
  ): boolean => {
    const snapshot = [...pixels];
    pixels = nextPixels;
    if (!pushUndoSnapshot(snapshot)) {
      pixels = snapshot;
      setStatus(noChangeMessage);
      return false;
    }

    setStatus(statusMessage);
    renderCanvas();
    return true;
  };

  const resetUndoHistory = (): void => {
    undoStack = [];
    pendingUndoSnapshot = null;
    syncCommandButtons();
  };

  const getPaletteColors = (): string[] => {
    const manualColors = manualPaletteColors.slice(0, SPRITE_PALETTE_MAX_COLORS);
    const presetColors = SPRITE_PRESET_COLORS
      .map((color) => color.toLowerCase())
      .filter((color) => !manualColors.includes(color));
    return [...manualColors, ...presetColors].slice(0, SPRITE_PALETTE_MAX_COLORS);
  };

  const renderSwatches = (): void => {
    if (!swatchGrid) {
      return;
    }

    swatchGrid.replaceChildren();
    for (const color of getPaletteColors()) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'editor-sprite-swatch';
      button.style.backgroundColor = color;
      button.title = color;
      button.setAttribute('aria-label', `Use ${color}`);
      button.addEventListener('click', () => {
        if (colorInput) {
          colorInput.value = color;
        }
        setActiveTool('pencil');
      });
      swatchGrid.appendChild(button);
    }
  };

  const rememberManualColor = (value: string): void => {
    const color = normalizeHexColor(value);
    if (!color || manualPaletteColors.includes(color)) {
      return;
    }

    manualPaletteColors = [...manualPaletteColors, color].slice(-SPRITE_PALETTE_MAX_COLORS);
    saveManualPaletteColors(manualPaletteColors);
    renderSwatches();
  };

  const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return (
      target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    );
  };

  const getActiveColor = (): string => {
    const color = colorInput?.value ?? '#fff3db';
    return isValidHexColor(color) ? color.toLowerCase() : '#fff3db';
  };

  const getKind = (): CustomSpriteKind | null => {
    const value = kindSelect?.value;
    return value === 'decoration' ||
      value === 'collectible' ||
      value === 'solid' ||
      value === 'pushable' ||
      value === 'sign'
      ? value
      : null;
  };

  const setUseAsPromptVisible = (visible: boolean): void => {
    kindHelp?.classList.toggle('hidden', !visible);
    if (kindSelect) {
      kindSelect.dataset.invalid = visible ? 'true' : 'false';
    }
  };

  const promptForUseAs = (): void => {
    saveAfterUseAsChoice = true;
    setUseAsPromptVisible(true);
    setStatus('Choose a Use As option before saving.', 'error');
    kindSelect?.focus();
  };

  const setKind = (kind: CustomSpriteKind): void => {
    if (kindSelect) {
      kindSelect.value = kind;
    }
    setUseAsPromptVisible(false);
  };

  const syncSizeButtons = (): void => {
    for (const button of sizeButtons) {
      const active = getSpriteSize(button.dataset.editorSpriteSize) === size;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = editingSpriteId !== null;
      button.title = editingSpriteId
        ? 'Start a new object to choose a different size.'
        : '';
    }
  };

  const getCanvasCell = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = Math.floor(((event.clientX - rect.left) / rect.width) * size);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * size);
    if (x < 0 || x >= size || y < 0 || y >= size) {
      return null;
    }

    return { x, y };
  };

  const paintCell = (x: number, y: number, mode: SpritePaintDragMode): void => {
    const index = y * size + x;
    const nextValue = mode === 'paint' ? getActiveColor() : null;
    if (pixels[index] === nextValue) {
      return;
    }

    pixels[index] = nextValue;
    renderCanvas();
  };

  const getClipboardAnchor = (cell: { x: number; y: number } | null): { x: number; y: number } | null => {
    if (!spriteClipboard) {
      return null;
    }

    const maxX = Math.max(0, size - spriteClipboard.bounds.width);
    const maxY = Math.max(0, size - spriteClipboard.bounds.height);
    const source = cell ?? lastCanvasCell ?? { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(maxX, source.x)),
      y: Math.max(0, Math.min(maxY, source.y)),
    };
  };

  const setClipboardPlacementActive = (active: boolean, statusMessage: string | null = null): void => {
    clipboardPlacementActive = active && spriteClipboard !== null;
    clipboardHoverCell = clipboardPlacementActive ? getClipboardAnchor(lastCanvasCell) : null;
    if (statusMessage) {
      setStatus(statusMessage);
    }
    syncCommandButtons();
    renderCanvas();
  };

  const buildClipboardFromCurrentPixels = (): SpriteClipboard | null => {
    const bounds = getSpritePixelBounds(pixels, size);
    if (!bounds) {
      setStatus('Draw something before copying.', 'error');
      return null;
    }

    return {
      size,
      pixels: [...pixels],
      bounds,
    };
  };

  const updateClipboardHover = (cell: { x: number; y: number } | null): void => {
    if (!clipboardPlacementActive || !spriteClipboard) {
      return;
    }

    const nextHover = getClipboardAnchor(cell);
    if (nextHover?.x === clipboardHoverCell?.x && nextHover?.y === clipboardHoverCell?.y) {
      return;
    }

    clipboardHoverCell = nextHover;
    renderCanvas();
  };

  const renderClipboardPlacementOverlay = (
    context: CanvasRenderingContext2D,
    cellSize: number,
  ): void => {
    if (!clipboardPlacementActive || !spriteClipboard || !clipboardHoverCell) {
      return;
    }

    const clipboard = spriteClipboard;
    const hoverCell = clipboardHoverCell;
    const { bounds } = clipboard;
    const getSourcePixel = (sourceX: number, sourceY: number): string | null => {
      if (sourceX < 0 || sourceX >= clipboard.size || sourceY < 0 || sourceY >= clipboard.size) {
        return null;
      }
      return clipboard.pixels[sourceY * clipboard.size + sourceX] ?? null;
    };

    context.save();
    context.globalAlpha = 0.48;
    for (let sourceY = bounds.minY; sourceY <= bounds.maxY; sourceY += 1) {
      for (let sourceX = bounds.minX; sourceX <= bounds.maxX; sourceX += 1) {
        const color = getSourcePixel(sourceX, sourceY);
        if (!color) {
          continue;
        }

        const targetX = hoverCell.x + sourceX - bounds.minX;
        const targetY = hoverCell.y + sourceY - bounds.minY;
        if (targetX < 0 || targetX >= size || targetY < 0 || targetY >= size) {
          continue;
        }

        context.fillStyle = color;
        context.fillRect(targetX * cellSize, targetY * cellSize, cellSize, cellSize);
      }
    }
    context.restore();

    const strokeOutline = (strokeStyle: string, lineWidth: number): void => {
      context.save();
      context.strokeStyle = strokeStyle;
      context.lineWidth = lineWidth;
      context.lineCap = 'square';
      context.beginPath();
      for (let sourceY = bounds.minY; sourceY <= bounds.maxY; sourceY += 1) {
        for (let sourceX = bounds.minX; sourceX <= bounds.maxX; sourceX += 1) {
          if (!getSourcePixel(sourceX, sourceY)) {
            continue;
          }

          const targetX = hoverCell.x + sourceX - bounds.minX;
          const targetY = hoverCell.y + sourceY - bounds.minY;
          if (targetX < 0 || targetX >= size || targetY < 0 || targetY >= size) {
            continue;
          }

          const left = targetX * cellSize;
          const top = targetY * cellSize;
          const right = left + cellSize;
          const bottom = top + cellSize;
          if (!getSourcePixel(sourceX - 1, sourceY)) {
            context.moveTo(left, top);
            context.lineTo(left, bottom);
          }
          if (!getSourcePixel(sourceX + 1, sourceY)) {
            context.moveTo(right, top);
            context.lineTo(right, bottom);
          }
          if (!getSourcePixel(sourceX, sourceY - 1)) {
            context.moveTo(left, top);
            context.lineTo(right, top);
          }
          if (!getSourcePixel(sourceX, sourceY + 1)) {
            context.moveTo(left, bottom);
            context.lineTo(right, bottom);
          }
        }
      }
      context.stroke();
      context.restore();
    };

    strokeOutline('#18161c', Math.max(4, Math.floor(cellSize * 0.12)));
    strokeOutline('#fff3db', Math.max(2, Math.floor(cellSize * 0.06)));
  };

  const renderCanvas = (): void => {
    const displayPixels = size === 16 ? 512 : 640;
    canvas.width = displayPixels;
    canvas.height = displayPixels;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.imageSmoothingEnabled = false;
    const cellSize = displayPixels / size;
    context.clearRect(0, 0, displayPixels, displayPixels);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const checkerLight = (x + y) % 2 === 0;
        context.fillStyle = checkerLight ? SPRITE_EDITOR_CHECKER_LIGHT : SPRITE_EDITOR_CHECKER_DARK;
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    for (let index = 0; index < pixels.length; index += 1) {
      const color = pixels[index];
      if (!color) {
        continue;
      }
      const x = index % size;
      const y = Math.floor(index / size);
      context.fillStyle = color;
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }

    context.strokeStyle = size === 16 ? 'rgba(24, 22, 28, 0.22)' : 'rgba(24, 22, 28, 0.14)';
    context.lineWidth = 1;
    for (let index = 0; index <= size; index += 1) {
      const line = Math.floor(index * cellSize) + 0.5;
      context.beginPath();
      context.moveTo(line, 0);
      context.lineTo(line, displayPixels);
      context.stroke();
      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(displayPixels, line);
      context.stroke();
    }

    renderClipboardPlacementOverlay(context, cellSize);
    renderPreview();
  };

  const renderPreview = (): void => {
    if (!previewCanvas) {
      return;
    }

    previewCanvas.width = 64;
    previewCanvas.height = 64;
    const context = previewCanvas.getContext('2d');
    if (!context) {
      return;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, 64, 64);
    const cellSize = 64 / size;
    for (let index = 0; index < pixels.length; index += 1) {
      const color = pixels[index];
      if (!color) {
        continue;
      }
      const x = index % size;
      const y = Math.floor(index / size);
      context.fillStyle = color;
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  };

  const fillFromCell = (x: number, y: number): void => {
    const startIndex = y * size + x;
    const targetColor = pixels[startIndex] ?? null;
    const replacementColor = getActiveColor();
    if (targetColor === replacementColor) {
      setStatus('That area already uses the selected color.');
      return;
    }

    const snapshot = [...pixels];
    const visited = new Uint8Array(pixels.length);
    const stack = [startIndex];
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined || visited[index] || (pixels[index] ?? null) !== targetColor) {
        continue;
      }

      visited[index] = 1;
      pixels[index] = replacementColor;
      const cellX = index % size;
      const cellY = Math.floor(index / size);
      if (cellX > 0) {
        stack.push(index - 1);
      }
      if (cellX < size - 1) {
        stack.push(index + 1);
      }
      if (cellY > 0) {
        stack.push(index - size);
      }
      if (cellY < size - 1) {
        stack.push(index + size);
      }
    }

    if (pushUndoSnapshot(snapshot)) {
      setStatus('Area filled.');
      renderCanvas();
    }
  };

  const copySprite = (): void => {
    const nextClipboard = buildClipboardFromCurrentPixels();
    if (!nextClipboard) {
      return;
    }

    spriteClipboard = nextClipboard;
    lastCanvasCell = { x: nextClipboard.bounds.minX, y: nextClipboard.bounds.minY };
    setClipboardPlacementActive(true, 'Copied. Move the outline over the canvas and click to place it.');
  };

  const cutSprite = (): void => {
    const nextClipboard = buildClipboardFromCurrentPixels();
    if (!nextClipboard) {
      return;
    }

    spriteClipboard = nextClipboard;
    lastCanvasCell = { x: nextClipboard.bounds.minX, y: nextClipboard.bounds.minY };
    replacePixelsWithUndo(createEmptyPixels(), 'Cut. Move the outline over the canvas and click to place it.', 'Canvas copied; nothing to cut.');
    setClipboardPlacementActive(true);
  };

  const placeClipboardAt = (anchor: { x: number; y: number } | null): void => {
    if (!spriteClipboard || !anchor) {
      setStatus('Copy or cut a sprite canvas before pasting.', 'error');
      return;
    }

    const nextPixels = [...pixels];
    let changed = false;
    const { bounds } = spriteClipboard;
    for (let sourceY = bounds.minY; sourceY <= bounds.maxY; sourceY += 1) {
      for (let sourceX = bounds.minX; sourceX <= bounds.maxX; sourceX += 1) {
        const color = spriteClipboard.pixels[sourceY * spriteClipboard.size + sourceX] ?? null;
        if (!color) {
          continue;
        }

        const targetX = anchor.x + sourceX - bounds.minX;
        const targetY = anchor.y + sourceY - bounds.minY;
        if (targetX < 0 || targetX >= size || targetY < 0 || targetY >= size) {
          continue;
        }

        const targetIndex = targetY * size + targetX;
        if (nextPixels[targetIndex] !== color) {
          changed = true;
          nextPixels[targetIndex] = color;
        }
      }
    }

    if (!changed) {
      setStatus('Copied pixels already match here.');
      return;
    }

    replacePixelsWithUndo(nextPixels, 'Placed copied pixels. Click again to place another copy.', 'Copied pixels already match here.');
  };

  const pasteSprite = (): void => {
    if (!spriteClipboard) {
      setStatus('Copy or cut a sprite canvas before pasting.', 'error');
      return;
    }

    setClipboardPlacementActive(true, 'Move the outline over the canvas and click to place it.');
  };

  const undoSpriteEdit = (): void => {
    const snapshot = undoStack.pop();
    if (!snapshot) {
      setStatus('Nothing to undo.');
      syncCommandButtons();
      return;
    }

    pendingUndoSnapshot = null;
    pixels = snapshot;
    setStatus('Undid last sprite edit.');
    syncCommandButtons();
    renderCanvas();
  };

  const setActiveTool = (nextTool: SpritePaintTool): void => {
    const wasPlacingClipboard = clipboardPlacementActive;
    clipboardPlacementActive = false;
    clipboardHoverCell = null;
    activeTool = nextTool;
    for (const button of toolButtons) {
      const active = button.dataset.editorSpriteTool === activeTool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    syncCommandButtons();
    if (wasPlacingClipboard) {
      renderCanvas();
    }
  };

  const setSize = (nextSize: CustomSpriteSize): void => {
    if (editingSpriteId && nextSize !== size) {
      setStatus('Start a new object to choose a different size.', 'error');
      return;
    }

    if (nextSize !== size) {
      size = nextSize;
      pixels = createEmptyPixels();
      clipboardPlacementActive = false;
      clipboardHoverCell = null;
      resetUndoHistory();
      setStatus(`${size}x${size} canvas ready.`);
    }

    syncSizeButtons();
    renderCanvas();
  };

  const refreshSpriteInActiveScenes = (sprite: CustomSpriteDefinition): void => {
    for (const scene of game.scene.getScenes(true)) {
      refreshCustomSpriteTexture(scene, buildCustomSpriteObjectId(sprite.id));
      const editorScene = scene as { rebuildObjectSprites?: () => void; updateToolUi?: () => void };
      editorScene.rebuildObjectSprites?.();
      editorScene.updateToolUi?.();
    }
  };

  const renderLibrary = (): void => {
    if (!libraryList) {
      return;
    }

    const sprites = listLocalCustomSpriteDefinitions();
    libraryList.replaceChildren();
    if (sprites.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'editor-sprite-library-empty';
      empty.textContent = 'No saved objects yet.';
      libraryList.appendChild(empty);
      return;
    }

    for (const sprite of sprites) {
      const item = doc.createElement('div');
      item.className = 'editor-sprite-library-item';
      const active = sprite.id === editingSpriteId;
      item.classList.toggle('active', active);

      const selectButton = doc.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'editor-sprite-library-select';
      selectButton.setAttribute('aria-pressed', active ? 'true' : 'false');

      const preview = doc.createElement('span');
      preview.className = 'editor-sprite-library-preview';
      preview.style.setProperty('--editor-sprite-preview-image', `url("${getCustomSpriteDataUrl(sprite)}")`);

      const copy = doc.createElement('span');
      copy.className = 'editor-sprite-library-copy';
      const name = doc.createElement('span');
      name.className = 'editor-sprite-library-name';
      name.textContent = sprite.name;
      const meta = doc.createElement('span');
      meta.className = 'editor-sprite-library-meta';
      const sync = getLocalCustomSpriteMetadata(sprite.id);
      const syncLabel = sync?.syncStatus === 'synced'
        ? 'Shared'
        : sync?.syncStatus === 'pending'
          ? 'Sharing…'
          : sync?.syncStatus === 'error'
            ? 'Share failed'
            : 'Saved locally';
      meta.textContent = `${sprite.size}x${sprite.size} · ${getCustomSpriteKindLabel(sprite.kind)} · ${syncLabel}`;
      if (sync?.syncError) meta.title = sync.syncError;
      copy.append(name, meta);
      selectButton.append(preview, copy);
      selectButton.addEventListener('click', () => {
        loadSpriteForEditing(sprite);
      });

      const deleteButton = doc.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'editor-sprite-library-delete';
      deleteButton.textContent = 'Delete';
      deleteButton.title = `Delete ${sprite.name}`;
      deleteButton.setAttribute('aria-label', `Delete ${sprite.name}`);
      deleteButton.addEventListener('click', () => {
        void deleteSprite(sprite, deleteButton);
      });

      item.append(selectButton, deleteButton);
      libraryList.appendChild(item);
    }
  };

  const resetSpriteDraft = (): void => {
    editingSpriteId = null;
    remixedFromSpriteId = null;
    size = 16;
    pixels = createEmptyPixels();
    clipboardPlacementActive = false;
    clipboardHoverCell = null;
    resetUndoHistory();
    if (nameInput) {
      nameInput.value = 'My Sprite';
    }
    if (kindSelect) {
      kindSelect.value = '';
    }
    saveAfterUseAsChoice = false;
    setUseAsPromptVisible(false);
    syncSizeButtons();
    renderCanvas();
    renderLibrary();
    setStatus('New object. Draw a sprite, choose what it does, then save.');
  };

  const loadSpriteForEditing = (sprite: CustomSpriteDefinition): void => {
    editingSpriteId = sprite.id;
    remixedFromSpriteId = getLocalCustomSpriteMetadata(sprite.id)?.remixedFromSpriteId ?? null;
    size = sprite.size;
    pixels = Array.from({ length: size * size }, (_, index) => sprite.pixels[index] ?? null);
    clipboardPlacementActive = false;
    clipboardHoverCell = null;
    resetUndoHistory();
    if (nameInput) {
      nameInput.value = sprite.name;
    }
    if (kindSelect) {
      kindSelect.value = sprite.kind;
    }
    saveAfterUseAsChoice = false;
    setUseAsPromptVisible(false);
    syncSizeButtons();
    renderCanvas();
    renderLibrary();
    setStatus(`Editing ${sprite.name}. Rooms already containing it keep their saved copy.`);
  };

  const loadSpriteForRemixing = (entry: CustomSpriteCatalogEntry): void => {
    editingSpriteId = null;
    remixedFromSpriteId = entry.sprite.id;
    size = entry.sprite.size;
    pixels = [...entry.sprite.pixels];
    clipboardPlacementActive = false;
    clipboardHoverCell = null;
    resetUndoHistory();
    if (nameInput) nameInput.value = clampSpriteName(`${entry.sprite.name} Remix`);
    if (kindSelect) kindSelect.value = entry.sprite.kind;
    saveAfterUseAsChoice = false;
    setUseAsPromptVisible(false);
    syncSizeButtons();
    renderCanvas();
    renderLibrary();
    setStatus(`Remixing ${entry.sprite.name} by ${entry.creator.displayName}. Saving creates your own copy.`);
    setSpriteModeActive(true);
  };

  const deleteSprite = async (
    sprite: CustomSpriteDefinition,
    deleteButton: HTMLButtonElement,
  ): Promise<void> => {
    if (!window.confirm(`Delete "${sprite.name}" from My Objects? This cannot be undone.`)) {
      return;
    }

    deleteButton.disabled = true;
    setStatus(`Checking whether ${sprite.name} is used in a room...`);
    const isUsedLocally = (spriteId: string): boolean => {
      if (isCustomSpriteUsedInLocalRoomStorage(spriteId)) return true;
      let usedInActiveEditor = false;
      withActiveEditorScene(game, (scene) => {
        usedInActiveEditor = scene.usesCustomSprite?.(spriteId) ?? false;
      });
      return usedInActiveEditor;
    };
    let result: Awaited<ReturnType<typeof deleteCustomSpriteIfUnused>> = 'verification-failed';
    const metadata = getLocalCustomSpriteMetadata(sprite.id);
    const isOwnedCatalogSprite = Boolean(
      metadata?.revision
      && metadata.ownerUserId
      && metadata.ownerUserId === getCurrentCustomSpriteOwnerUserId()
    );
    if (isUsedLocally(sprite.id)) {
      result = 'in-use';
    } else if (isOwnedCatalogSprite) {
      try {
        await deleteCommunityCustomSprite(sprite.id);
        result = removeLocalCustomSprite(sprite.id) ? 'deleted' : 'not-local';
      } catch (error) {
        result = error instanceof CustomSpriteCatalogApiError && error.status === 409
          ? 'in-use'
          : 'verification-failed';
      }
    } else {
      result = await deleteCustomSpriteIfUnused(sprite.id, {
        isUsedLocally,
        loadRemoteUsage: loadCustomSpriteUsage,
        removeLocalSprite: removeLocalCustomSprite,
      });
    }

    if (result === 'deleted') {
      if (editorState.selectedObjectId === buildCustomSpriteObjectId(sprite.id)) {
        editorState.selectedObjectId = null;
      }
      if (editingSpriteId === sprite.id) {
        resetSpriteDraft();
      } else {
        renderLibrary();
      }
      setStatus(`Deleted ${sprite.name}.`);
      return;
    }
    if (result === 'in-use') {
      setStatus(
        `Can't delete ${sprite.name} while it is used in a room. Remove it everywhere and save or publish those rooms first.`,
        'error',
      );
    } else if (result === 'verification-failed') {
      setStatus(`Couldn't verify whether ${sprite.name} is used. Nothing was deleted.`, 'error');
    } else {
      setStatus(`${sprite.name} is no longer in My Objects.`, 'error');
    }
    deleteButton.disabled = false;
  };

  const setSpriteModeActive = (active: boolean): void => {
    if (!active) {
      clipboardPlacementActive = false;
      clipboardHoverCell = null;
      syncCommandButtons();
    }
    doc.body.dataset.editorSpriteMode = active ? 'true' : 'false';
    doc.body.dataset.editorSpriteUiLocked = active ? 'true' : 'false';
    overlay.classList.toggle('hidden', !active);
    modeButton.classList.toggle('active', active);
    modeButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    modeButton.title = active ? 'Close Sprite Editor' : 'Sprite Editor';
    const label = modeButton.querySelector<HTMLElement>('[data-button-label], .tool-label');
    if (label) {
      label.textContent = active ? 'Close' : 'Sprite';
    }

    if (active) {
      void refreshOwnedCustomSprites().catch(() => undefined);
      withActiveEditorScene(game, (scene) => scene.setMusicModeActive?.(false));
      editorState.paletteMode = 'objects';
      renderLibrary();
      renderCanvas();
      window.requestAnimationFrame(() => {
        nameInput?.focus();
        nameInput?.select();
        syncGameKeyboardFocus(game);
      });
    }

    window.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
  };

  const buildSpriteDraft = (kind: CustomSpriteKind): CustomSpriteDefinition | null => {
    if (!pixels.some(Boolean)) {
      setStatus('Draw at least one pixel before saving.', 'error');
      return null;
    }

    const now = new Date().toISOString();
    const existing = getCustomSpriteDefinition(editingSpriteId);
    return {
      id: existing?.id ?? createSpriteId(),
      name: clampSpriteName(nameInput?.value ?? ''),
      size,
      kind,
      pixels: [...pixels],
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  };

  const saveSpriteAsObject = (sprite: CustomSpriteDefinition): void => {
    editingSpriteId = sprite.id;
    editorState.paletteMode = 'objects';
    editorState.selectedObjectId = buildCustomSpriteObjectId(sprite.id);
    editorState.objectFacing = 'right';
    editorState.activeTool = 'pencil';
    registerCustomSprite(sprite, { remixedFromSpriteId });
    queueCustomSpriteSync();
    refreshSpriteInActiveScenes(sprite);
    renderLibrary();
    setStatus(getCurrentCustomSpriteOwnerUserId()
      ? 'Saved. Sharing to Community; click in the room to place it.'
      : 'Saved locally. Sign in to share it with Community.');
    setSpriteModeActive(false);
  };

  const saveSpriteAsTile = (sprite: CustomSpriteDefinition): void => {
    let selectedTile = false;
    withActiveEditorScene(game, (scene) => {
      selectedTile = scene.useCustomSpriteAsTile?.(sprite) ?? false;
    });
    if (!selectedTile) {
      setStatus('Open an editable room before saving a tile.', 'error');
      return;
    }

    registerCustomSprite(sprite, { remixedFromSpriteId });
    queueCustomSpriteSync();
    refreshSpriteInActiveScenes(sprite);
    editingSpriteId = sprite.id;
    renderLibrary();
    setStatus(getCurrentCustomSpriteOwnerUserId()
      ? 'Saved as tile and sharing to Community. Click in the room to paint it.'
      : 'Saved locally as a tile. Sign in to share it with Community.');
    setSpriteModeActive(false);
  };

  const saveSprite = (): void => {
    if (!pixels.some(Boolean)) {
      setStatus('Draw at least one pixel before saving.', 'error');
      return;
    }

    const kind = getKind();
    if (!kind) {
      promptForUseAs();
      return;
    }

    saveAfterUseAsChoice = false;
    setUseAsPromptVisible(false);

    if (!editingSpriteId && listLocalCustomSpriteDefinitions().length >= CUSTOM_SPRITE_ACCOUNT_LIMIT) {
      setStatus(`My Objects can hold up to ${CUSTOM_SPRITE_ACCOUNT_LIMIT} sprites. Delete an unused one before saving another.`, 'error');
      return;
    }

    const sprite = buildSpriteDraft(kind);
    if (!sprite) {
      return;
    }

    if (canCustomSpriteBecomeRoomTile(sprite)) {
      saveSpriteAsTile(sprite);
      return;
    }

    saveSpriteAsObject(sprite);
  };

  modeButton.addEventListener('click', () => {
    setSpriteModeActive(doc.body.dataset.editorSpriteMode !== 'true');
  });
  closeButton?.addEventListener('click', () => setSpriteModeActive(false));
  newButton?.addEventListener('click', resetSpriteDraft);
  saveButton?.addEventListener('click', saveSprite);
  clearButton?.addEventListener('click', () => {
    replacePixelsWithUndo(createEmptyPixels(), 'Canvas cleared.', 'Canvas is already clear.');
  });
  undoButton?.addEventListener('click', undoSpriteEdit);
  copyButton?.addEventListener('click', copySprite);
  cutButton?.addEventListener('click', cutSprite);
  pasteButton?.addEventListener('click', pasteSprite);

  kindSelect?.addEventListener('change', () => {
    const kind = getKind();
    if (!kind) {
      return;
    }
    setUseAsPromptVisible(false);
    if (saveAfterUseAsChoice) {
      saveSprite();
    }
  });

  for (const button of kindChoiceButtons) {
    button.addEventListener('click', () => {
      const value = button.dataset.editorSpriteKindChoice;
      if (
        value !== 'decoration' &&
        value !== 'collectible' &&
        value !== 'solid' &&
        value !== 'pushable' &&
        value !== 'sign'
      ) {
        return;
      }
      setKind(value);
      if (saveAfterUseAsChoice) {
        saveSprite();
      }
    });
  }

  for (const button of sizeButtons) {
    button.addEventListener('click', () => setSize(getSpriteSize(button.dataset.editorSpriteSize)));
  }

  for (const button of toolButtons) {
    button.addEventListener('click', () => {
      const value = button.dataset.editorSpriteTool;
      const tool: SpritePaintTool = value === 'eraser' || value === 'fill' ? value : 'pencil';
      setActiveTool(tool);
    });
  }

  renderSwatches();
  colorInput?.addEventListener('change', () => {
    rememberManualColor(getActiveColor());
  });

  canvas.addEventListener('pointerdown', (event) => {
    const cell = getCanvasCell(event);
    if (!cell) {
      return;
    }
    lastCanvasCell = cell;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (clipboardPlacementActive && spriteClipboard) {
      updateClipboardHover(cell);
      placeClipboardAt(clipboardHoverCell);
      return;
    }

    if (activeTool === 'fill') {
      fillFromCell(cell.x, cell.y);
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    isPointerDown = true;
    const index = cell.y * size + cell.x;
    beginPixelEdit();
    dragMode =
      activeTool === 'eraser' || pixels[index] === getActiveColor()
        ? 'erase'
        : 'paint';
    paintCell(cell.x, cell.y, dragMode);
  });

  canvas.addEventListener('pointermove', (event) => {
    const cell = getCanvasCell(event);
    if (!cell) {
      if (clipboardPlacementActive && clipboardHoverCell) {
        clipboardHoverCell = null;
        renderCanvas();
      }
      return;
    }
    lastCanvasCell = cell;
    if (clipboardPlacementActive) {
      updateClipboardHover(cell);
      return;
    }

    if (!isPointerDown || !dragMode) {
      return;
    }
    event.preventDefault();
    paintCell(cell.x, cell.y, dragMode);
  });

  const stopPointer = (event: PointerEvent) => {
    if (isPointerDown && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (isPointerDown) {
      commitPixelEdit();
    }
    isPointerDown = false;
    dragMode = null;
  };
  canvas.addEventListener('pointerup', stopPointer);
  canvas.addEventListener('pointercancel', stopPointer);
  canvas.addEventListener('pointerleave', () => {
    if (clipboardPlacementActive && clipboardHoverCell) {
      clipboardHoverCell = null;
      renderCanvas();
    }
  });

  doc.addEventListener(
    'keydown',
    (event) => {
      if (doc.body.dataset.editorSpriteMode !== 'true' || isEditableShortcutTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'escape' && clipboardPlacementActive) {
        event.preventDefault();
        setClipboardPlacementActive(false, 'Placement canceled.');
        return;
      }

      const primaryModifier = event.metaKey || event.ctrlKey;
      if (primaryModifier && !event.altKey) {
        if (key === 'z') {
          event.preventDefault();
          undoSpriteEdit();
          return;
        }
        if (key === 'c') {
          event.preventDefault();
          copySprite();
          return;
        }
        if (key === 'x') {
          event.preventDefault();
          cutSprite();
          return;
        }
        if (key === 'v') {
          event.preventDefault();
          pasteSprite();
        }
        return;
      }

      if (event.altKey || event.shiftKey) {
        return;
      }

      if (key === 'g') {
        event.preventDefault();
        setActiveTool('fill');
      } else if (key === 'e') {
        event.preventDefault();
        setActiveTool('eraser');
      } else if (key === 'b' || key === 'p') {
        event.preventDefault();
        setActiveTool('pencil');
      }
    },
    { capture: true }
  );

  for (const input of [nameInput, kindSelect, colorInput]) {
    input?.addEventListener('focus', () => syncGameKeyboardFocus(game));
    input?.addEventListener('blur', () => syncGameKeyboardFocus(game));
  }

  window.addEventListener(CUSTOM_SPRITES_CHANGED_EVENT, renderLibrary);
  window.addEventListener(CUSTOM_SPRITE_REMIX_REQUESTED_EVENT, (event) => {
    const entry = event instanceof CustomEvent
      ? event.detail as CustomSpriteCatalogEntry | undefined
      : undefined;
    if (entry?.sprite) loadSpriteForRemixing(entry);
  });
  window.addEventListener(CUSTOM_SPRITE_USE_REQUESTED_EVENT, (event) => {
    const entry = event instanceof CustomEvent
      ? event.detail as CustomSpriteCatalogEntry | undefined
      : undefined;
    if (!entry?.sprite) return;
    const sprite = entry.sprite;
    refreshSpriteInActiveScenes(sprite);
    if (canCustomSpriteBecomeRoomTile(sprite)) {
      let selected = false;
      withActiveEditorScene(game, (scene) => {
        selected = scene.useCustomSpriteAsTile?.(sprite) ?? false;
      });
      if (!selected) {
        setStatus('Open an editable room before using this tile.', 'error');
        return;
      }
      setStatus(`Using ${sprite.name} by ${entry.creator.displayName} as a tile.`);
    } else {
      editorState.paletteMode = 'objects';
      editorState.selectedObjectId = buildCustomSpriteObjectId(sprite.id);
      editorState.objectFacing = 'right';
      editorState.activeTool = 'pencil';
      window.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
      setStatus(`Using ${sprite.name} by ${entry.creator.displayName}.`);
    }
    setSpriteModeActive(false);
  });
  setActiveTool('pencil');
  resetSpriteDraft();
  syncCommandButtons();
  setSpriteModeActive(false);
}
