import Phaser from 'phaser';
import { editorState } from '../../config';
import {
  buildCustomSpriteObjectId,
  getCustomSpriteKindLabel,
  normalizeCustomSpriteKind,
  type CustomSpriteDefinition,
  type CustomSpriteKind,
  type CustomSpriteSize,
} from '../../customSprites/model';
import {
  CUSTOM_SPRITES_CHANGED_EVENT,
  getCustomSpriteDataUrl,
  getCustomSpriteDefinition,
  listLocalCustomSpriteDefinitions,
  refreshCustomSpriteTexture,
  registerCustomSprite,
} from '../../customSprites/registry';
import { EDITOR_UI_STATE_CHANGED_EVENT } from '../../scenes/editor/uiEvents';
import { syncGameKeyboardFocus } from '../keyboardFocus';
import { withActiveEditorScene } from './sceneBridge';

type SpritePaintTool = 'pencil' | 'eraser';
type SpritePaintDragMode = 'paint' | 'erase';

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
  const sizeButtons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>('[data-editor-sprite-size]')
  );
  const toolButtons = Array.from(
    doc.querySelectorAll<HTMLButtonElement>('[data-editor-sprite-tool]')
  );
  const swatchGrid = doc.getElementById('editor-sprite-swatches');
  const clearButton = doc.getElementById('btn-editor-sprite-clear') as HTMLButtonElement | null;
  const saveButton = doc.getElementById('btn-editor-sprite-save') as HTMLButtonElement | null;
  const saveTileButton = doc.getElementById('btn-editor-sprite-save-tile') as HTMLButtonElement | null;
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

  const setStatus = (message: string, tone: 'neutral' | 'error' = 'neutral') => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  const getActiveColor = (): string => {
    const color = colorInput?.value ?? '#fff3db';
    return isValidHexColor(color) ? color.toLowerCase() : '#fff3db';
  };

  const getKind = (): CustomSpriteKind => normalizeCustomSpriteKind(kindSelect?.value);

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

  const setActiveTool = (nextTool: SpritePaintTool): void => {
    activeTool = nextTool;
    for (const button of toolButtons) {
      const active = button.dataset.editorSpriteTool === activeTool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  const setSize = (nextSize: CustomSpriteSize): void => {
    if (editingSpriteId && nextSize !== size) {
      setStatus('Start a new object to choose a different size.', 'error');
      return;
    }

    if (nextSize !== size) {
      size = nextSize;
      pixels = Array.from({ length: size * size }, () => null);
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
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'editor-sprite-library-item';
      const active = sprite.id === editingSpriteId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');

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
      meta.textContent = `${sprite.size}x${sprite.size} · ${getCustomSpriteKindLabel(sprite.kind)}`;
      copy.append(name, meta);
      button.append(preview, copy);
      button.addEventListener('click', () => {
        loadSpriteForEditing(sprite);
      });
      libraryList.appendChild(button);
    }
  };

  const resetSpriteDraft = (): void => {
    editingSpriteId = null;
    size = 16;
    pixels = Array.from({ length: size * size }, () => null);
    if (nameInput) {
      nameInput.value = 'My Sprite';
    }
    if (kindSelect) {
      kindSelect.value = 'decoration';
    }
    syncSizeButtons();
    renderCanvas();
    renderLibrary();
    setStatus('New object. Draw a sprite, choose what it does, then save.');
  };

  const loadSpriteForEditing = (sprite: CustomSpriteDefinition): void => {
    editingSpriteId = sprite.id;
    size = sprite.size;
    pixels = Array.from({ length: size * size }, (_, index) => sprite.pixels[index] ?? null);
    if (nameInput) {
      nameInput.value = sprite.name;
    }
    if (kindSelect) {
      kindSelect.value = sprite.kind;
    }
    syncSizeButtons();
    renderCanvas();
    renderLibrary();
    setStatus(`Editing ${sprite.name}. Save updates this object everywhere it is reused.`);
  };

  const setSpriteModeActive = (active: boolean): void => {
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

  const buildSpriteDraft = (): CustomSpriteDefinition | null => {
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
      kind: getKind(),
      pixels: [...pixels],
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  };

  const saveSprite = (): void => {
    const sprite = buildSpriteDraft();
    if (!sprite) {
      return;
    }

    editingSpriteId = sprite.id;
    editorState.paletteMode = 'objects';
    editorState.selectedObjectId = buildCustomSpriteObjectId(sprite.id);
    editorState.objectFacing = 'right';
    editorState.activeTool = 'pencil';
    registerCustomSprite(sprite);
    refreshSpriteInActiveScenes(sprite);
    renderLibrary();
    setStatus('Saved. Click in the room to place it.');
    setSpriteModeActive(false);
  };

  const saveSpriteAsTile = (): void => {
    const sprite = buildSpriteDraft();
    if (!sprite) {
      return;
    }

    if (sprite.size !== 16) {
      setStatus('Tiles use the 16x16 sprite size.', 'error');
      return;
    }

    if (sprite.kind !== 'decoration' && sprite.kind !== 'solid') {
      setStatus('Pushable and collectible sprites stay as objects.', 'error');
      return;
    }

    registerCustomSprite(sprite);
    refreshSpriteInActiveScenes(sprite);
    let selectedTile = false;
    withActiveEditorScene(game, (scene) => {
      selectedTile = scene.useCustomSpriteAsTile?.(sprite) ?? false;
    });
    if (!selectedTile) {
      setStatus('Open an editable room before saving a tile.', 'error');
      return;
    }

    editingSpriteId = sprite.id;
    renderLibrary();
    setStatus('Saved as tile. Click in the room to paint it.');
    setSpriteModeActive(false);
  };

  modeButton.addEventListener('click', () => {
    setSpriteModeActive(doc.body.dataset.editorSpriteMode !== 'true');
  });
  closeButton?.addEventListener('click', () => setSpriteModeActive(false));
  newButton?.addEventListener('click', resetSpriteDraft);
  saveButton?.addEventListener('click', saveSprite);
  saveTileButton?.addEventListener('click', saveSpriteAsTile);
  clearButton?.addEventListener('click', () => {
    pixels = Array.from({ length: size * size }, () => null);
    setStatus('Canvas cleared.');
    renderCanvas();
  });

  for (const button of sizeButtons) {
    button.addEventListener('click', () => setSize(getSpriteSize(button.dataset.editorSpriteSize)));
  }

  for (const button of toolButtons) {
    button.addEventListener('click', () => {
      const tool = button.dataset.editorSpriteTool === 'eraser' ? 'eraser' : 'pencil';
      setActiveTool(tool);
    });
  }

  if (swatchGrid) {
    for (const color of SPRITE_PRESET_COLORS) {
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
  }

  canvas.addEventListener('pointerdown', (event) => {
    const cell = getCanvasCell(event);
    if (!cell) {
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    isPointerDown = true;
    const index = cell.y * size + cell.x;
    dragMode =
      activeTool === 'eraser' || pixels[index] === getActiveColor()
        ? 'erase'
        : 'paint';
    paintCell(cell.x, cell.y, dragMode);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!isPointerDown || !dragMode) {
      return;
    }
    const cell = getCanvasCell(event);
    if (!cell) {
      return;
    }
    event.preventDefault();
    paintCell(cell.x, cell.y, dragMode);
  });

  const stopPointer = (event: PointerEvent) => {
    if (isPointerDown && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    isPointerDown = false;
    dragMode = null;
  };
  canvas.addEventListener('pointerup', stopPointer);
  canvas.addEventListener('pointercancel', stopPointer);

  for (const input of [nameInput, kindSelect, colorInput]) {
    input?.addEventListener('focus', () => syncGameKeyboardFocus(game));
    input?.addEventListener('blur', () => syncGameKeyboardFocus(game));
  }

  window.addEventListener(CUSTOM_SPRITES_CHANGED_EVENT, renderLibrary);
  setActiveTool('pencil');
  resetSpriteDraft();
  setSpriteModeActive(false);
}
