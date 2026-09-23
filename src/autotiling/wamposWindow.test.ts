import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../config/room';
import { createEmptyTileData } from '../persistence/roomModel';
import { buildEditorClipboardState, planEditorSmartClipboardPaste } from '../scenes/editor/clipboard';
import { SmartTileController } from '../scenes/editor/smartTileController';
import { buildSmartPreviewTiles } from '../ui/setup/editorSmartPreview';
import { applyRegisteredSmartBrushCells, applyRegisteredSmartBrushOutlineCells } from './brushEngine';
import { createRoomSmartTerrainState, normalizeRoomSmartTerrainState, SMART_WAMPOS_BRUSH_IDS, type SmartWamposBrushId } from './model';
import { applyManualSmartOutputEdit, planSmartRecipeLayerClear, resolveSmartRecipeDocument, type SmartRecipeDocument } from './recipeSolver';
import { getSmartBrushDefinition, getSmartThemeDefinition } from './registry';
import { setSmartTerrainDetailsEnabled } from './solver';

const reference = JSON.parse(readFileSync('test/fixtures/smart-autotiling/references/wampos-x-11-y10.room.json', 'utf8')).snapshot;
const inactiveReference = JSON.parse(readFileSync('test/fixtures/smart-autotiling/references/wampos-inactive-x-13-y10.room.json', 'utf8')).snapshot;
const empty = (): SmartRecipeDocument => ({ tileData: createEmptyTileData(), smartTerrain: createRoomSmartTerrainState() });
const rect = (x: number, y: number, width: number, height: number) => Array.from({ length: width * height }, (_, i) => ({ x: x + i % width, y: y + Math.floor(i / width) }));
const paint = (doc = empty(), x = 2, y = 2, width = 10, height = 8, layer: LayerName = 'terrain', brushId: SmartWamposBrushId = 'wampos95.window') => applyRegisteredSmartBrushCells(doc, {
  brushId, styleId: 'wampos95', mode: 'paint', layer, cells: rect(x, y, width, height),
});
const tile = (coordinate: string): number => {
  const match = /^([A-Z])(\d+)$/.exec(coordinate)!;
  return 925 + (match[1].charCodeAt(0) - 65) * 12 + Number(match[2]) - 1;
};

describe('WampOS 95 regular Window', () => {
  it('matches the artist title, blank menu, white border/interior, and horizontal scrollbar', () => {
    const result = paint(empty(), 21, 5, 16, 13);
    for (const y of [5, 6, 7, 17]) {
      expect(result.tileData.terrain[y].slice(21, 37)).toEqual(reference.tileData.terrain[y].slice(21, 37));
    }
    for (let y = 8; y <= 16; y += 1) {
      expect(result.tileData.terrain[y][21]).toBe(reference.tileData.terrain[y][21]);
      expect(result.tileData.background[y].slice(22, 36)).toEqual(reference.tileData.background[y].slice(22, 36));
      expect(result.tileData.terrain[y].slice(22, 36)).toEqual(Array(14).fill(-1));
    }
    // The demo extends the thumb to the bottom; our resizable scrollbar also
    // includes its authored down arrow and track, without adding label/icons.
    expect(result.tileData.terrain[16][36]).toBe(tile('G10'));
    expect(result.tileData.terrain.flat()).toContain(tile('F10'));
    expect(result.tileData.foreground.flat().every((value) => value === -1)).toBe(true);
  });

  it.each([[5, 6], [6, 7], [12, 10], [ROOM_WIDTH, ROOM_HEIGHT]])('closes every edge at %ix%i without spilling', (width, height) => {
    const result = paint(empty(), ROOM_WIDTH - width, ROOM_HEIGHT - height, width, height);
    expect(Object.keys(result.smartTerrain.ownedOutputs)).toHaveLength(width * height);
    expect(result.tileData.terrain[ROOM_HEIGHT - 1][ROOM_WIDTH - 1]).toBe(tile('H10'));
    expect(result.tileData.terrain[ROOM_HEIGHT - 2][ROOM_WIDTH - 1]).toBe(tile('G10'));
    expect(resolveSmartRecipeDocument(result)).toEqual(result);
    expect(setSmartTerrainDetailsEnabled(result, false).tileData).toEqual(result.tileData);
  });

  it('ignores too-small, partial, and clipped-invalid rectangles without changing existing work', () => {
    const initial = paint();
    for (const [x, y, w, h] of [[2, 2, 4, 8], [2, 2, 8, 5], [38, 19, 8, 8]]) expect(paint(initial, x, y, w, h)).toEqual(initial);
    expect(applyRegisteredSmartBrushCells(initial, {
      brushId: 'wampos95.window', styleId: 'wampos95', mode: 'paint', cells: [{ x: 0, y: 0 }, { x: 20, y: 15 }],
    })).toEqual(initial);
  });

  it('keeps touching windows separate and resizes one from its top-left', () => {
    const initial = paint(paint(), 12, 2, 7, 8);
    expect(Object.keys(initial.smartTerrain.recipes)).toHaveLength(2);
    expect(initial.tileData.terrain[2][11]).toBe(tile('A7'));
    expect(initial.tileData.terrain[2][12]).toBe(tile('A5'));
    const smaller = paint(initial, 2, 2, 6, 6);
    expect(Object.keys(smaller.smartTerrain.recipes)).toHaveLength(2);
    expect(smaller.tileData.terrain[2][7]).toBe(tile('A7'));
    expect(smaller.tileData.terrain[2][8]).toBe(-1);
    expect(smaller.tileData.background[8][8]).toBe(-1);
    expect(smaller.tileData.terrain[2][12]).toBe(tile('A5'));
  });

  it('retains manual menu labels, title buttons, contents, and manual erased parts on future solves', () => {
    const result = paint();
    result.tileData.terrain[3][4] = tile('B2');
    result.smartTerrain = applyManualSmartOutputEdit(result.smartTerrain, 'terrain', 4, 3, tile('B2'));
    result.tileData.terrain[7][5] = tile('V5');
    result.tileData.foreground[2][10] = tile('A4');
    result.tileData.background[6][6] = -1;
    result.smartTerrain = applyManualSmartOutputEdit(result.smartTerrain, 'background', 6, 6, -1);
    const next = paint(result, 20, 2, 8, 7);
    expect(next.tileData.terrain[3][4]).toBe(tile('B2'));
    expect(next.tileData.terrain[7][5]).toBe(tile('V5'));
    expect(next.tileData.foreground[2][10]).toBe(tile('A4'));
    expect(next.tileData.background[6][6]).toBe(-1);
    const restored = { ...next, smartTerrain: normalizeRoomSmartTerrainState(JSON.parse(JSON.stringify(next.smartTerrain))) };
    expect(resolveSmartRecipeDocument(restored)).toEqual(next);
  });

  it.each(['background', 'terrain', 'foreground'] as const)('persists and clears Window on %s including generated white', (layer) => {
    const result = paint(empty(), 2, 2, 8, 7, layer);
    expect(result.tileData[layer][2][2]).toBe(tile('A5'));
    const contentLayer = layer === 'terrain' ? 'background' : layer;
    expect(result.tileData[contentLayer][5][4]).toBe(tile('D2'));
    const plan = planSmartRecipeLayerClear(result.smartTerrain, layer);
    expect(Object.keys(plan.smartTerrain.recipes)).toHaveLength(0);
    expect(plan.removedOutputs).toHaveLength(56);
    expect(resolveSmartRecipeDocument({ ...result, smartTerrain: normalizeRoomSmartTerrainState(result.smartTerrain) })).toEqual(result);
  });

  it('erases source cells and their white companions without moving the surviving frame', () => {
    const result = applyRegisteredSmartBrushCells(paint(), {
      brushId: 'wampos95.window', styleId: 'wampos95', mode: 'erase', cells: [{ x: 5, y: 5 }, { x: 2, y: 2 }],
    });
    expect(result.tileData.background[5][5]).toBe(-1);
    expect(result.tileData.terrain[2][2]).toBe(-1);
    expect(result.tileData.terrain[2][3]).toBe(tile('A6'));
    expect(Object.values(result.smartTerrain.recipes)[0].bounds.minX).toBe(2);
    expect(resolveSmartRecipeDocument(result)).toEqual(result);
  });

  it.each(['forest.ground', 'cyber.concrete', 'cyber.support'] as const)('replaces %s sources cleanly and does not regrow Window through later edits', (brushId) => {
    const styleId = brushId === 'forest.ground' ? 'forest' : 'cyber-yellow';
    const cells = rect(2, 2, 10, 8);
    const underlay = applyRegisteredSmartBrushCells(empty(), { brushId, styleId, layer: 'terrain', cells, mode: 'paint' });
    const window = paint(underlay);
    expect(window.tileData.terrain[2][2]).toBe(tile('A5'));
    expect(window.tileData.terrain[5][5]).toBe(-1);
    const replaced = applyRegisteredSmartBrushCells(window, { brushId, styleId, layer: 'terrain', cells: [{ x: 2, y: 2 }], mode: 'paint' });
    const erased = applyRegisteredSmartBrushCells(replaced, { brushId, styleId, layer: 'terrain', cells: [{ x: 2, y: 2 }], mode: 'erase' });
    expect(resolveSmartRecipeDocument(erased).tileData.terrain[2][2]).toBe(-1);
  });

  it('copies a complete window with its generated background, while partial copies stay literal', () => {
    const doc = paint(empty(), 2, 2, 8, 7);
    const copy = (x2: number) => buildEditorClipboardState('terrain', 2, 2, x2, 8, (x, y) => doc.tileData.terrain[y][x], undefined, doc.smartTerrain)!;
    expect(copy(7).smartRecipes).toBeUndefined();
    const clipboard = copy(9);
    expect(clipboard.smartRecipes).toHaveLength(1);
    const plan = planEditorSmartClipboardPaste(clipboard, 20, 10, 'terrain');
    const controller = new SmartTileController(() => ({ brushId: 'wampos95.window', styleId: 'wampos95' }));
    const pasted = controller.applyClipboardPlan(doc, plan);
    expect(pasted.tileData.terrain[10][20]).toBe(tile('A5'));
    expect(pasted.tileData.background[13][22]).toBe(tile('D2'));
    expect(Object.keys(pasted.smartTerrain.recipes)).toHaveLength(2);
    expect(resolveSmartRecipeDocument(pasted)).toEqual(pasted);
    expect(planEditorSmartClipboardPaste(clipboard, 38, 20, 'terrain').recipes).toHaveLength(0);
  });

  it('releases replaced outline sources and clears suppressions before reusing a window ID', () => {
    const initial = paint();
    initial.tileData.terrain[3][4] = tile('B2');
    initial.smartTerrain = applyManualSmartOutputEdit(initial.smartTerrain, 'terrain', 4, 3, tile('B2'));
    const outlined = applyRegisteredSmartBrushOutlineCells(initial, {
      brushId: 'cyber.concrete', styleId: 'cyber-yellow',
      filledCells: rect(2, 2, 10, 8), outlineCells: rect(2, 2, 10, 1),
    });
    expect(Object.values(outlined.smartTerrain.recipes)[0].sourceCells.some((c) => c.y === 2)).toBe(false);
    const overwritten = applyRegisteredSmartBrushCells(outlined, {
      brushId: 'forest.ground', styleId: 'forest', cells: rect(2, 2, 10, 8), mode: 'paint',
    });
    expect(Object.keys(overwritten.smartTerrain.recipes)).toHaveLength(0);
    expect(overwritten.smartTerrain.suppressedOutputParts.filter((part) => part.startsWith('wampos95:'))).toEqual([]);
    const replaced = paint(overwritten);
    expect(replaced.tileData.terrain[3][4]).toBe(tile('D5'));
  });

  it('registers the WampOS family with complete renderer-backed previews', () => {
    expect(getSmartThemeDefinition('wampos95').brushIds).toEqual(SMART_WAMPOS_BRUSH_IDS);
    expect(getSmartBrushDefinition('wampos95.window').supportedTools).toEqual(['rect']);
    expect(getSmartBrushDefinition('wampos95.start-bar').supportedTools).toEqual(['line']);
    expect(buildSmartPreviewTiles('wampos95.inactive-window', 'wampos95')).toHaveLength(60);
    expect(buildSmartPreviewTiles('wampos95.alert', 'wampos95')).toHaveLength(60);
    expect(buildSmartPreviewTiles('wampos95.start-bar', 'wampos95')).toHaveLength(10);
    const preview = buildSmartPreviewTiles('wampos95.window', 'wampos95');
    expect(preview).toHaveLength(60);
    expect(preview.some((t) => t.sourceX === 9 * 16 && t.sourceY === 7 * 16)).toBe(true);
  });
});


describe('WampOS alert, inactive window, and Start Bar', () => {
  it('uses the inactive title from -13,10 while retaining the complete regular Window body', () => {
    const active = paint(empty(), 2, 2, 7, 8);
    const inactive = paint(empty(), 2, 2, 7, 8, 'terrain', 'wampos95.inactive-window');
    expect(inactive.tileData.terrain[2].slice(2, 9)).toEqual(inactiveReference.tileData.terrain[5].slice(5, 12));
    expect(inactive.tileData.terrain.slice(3)).toEqual(active.tileData.terrain.slice(3));
    expect(inactive.tileData.background).toEqual(active.tileData.background);
  });

  it('matches the visible alert chrome in -11,10 and leaves message/button/icon placement manual', () => {
    const result = paint(empty(), 14, 3, 9, 6, 'background', 'wampos95.alert');
    for (const y of [3, 4]) expect(result.tileData.background[y].slice(14, 23)).toEqual(reference.tileData.background[y].slice(14, 23));
    for (const y of [5, 6, 8]) expect(result.tileData.background[y].slice(14, 21)).toEqual(reference.tileData.background[y].slice(14, 21));
    expect(result.tileData.background[7].slice(15, 22)).toEqual(Array(7).fill(tile('D5')));
    expect(result.tileData.background[8][22]).toBe(tile('H3'));
    expect(result.tileData.terrain.flat().every((value) => value === -1)).toBe(true);
    expect(result.tileData.foreground.flat().every((value) => value === -1)).toBe(true);
  });

  it('matches the blank Start frame, strip, and tray from -13,10', () => {
    const result = paint(empty(), 0, 21, ROOM_WIDTH, 1, 'terrain', 'wampos95.start-bar');
    expect(result.tileData.terrain[21].slice(0, 36)).toEqual(inactiveReference.tileData.background[21].slice(0, 36));
    for (const x of [36, 37, 39]) expect(result.tileData.terrain[21][x]).toBe(inactiveReference.tileData.terrain[21][x]);
    expect(result.tileData.terrain[21][38]).toBe(tile('K9')); // The reference clock digit is a manual label.
    expect(result.tileData.background.flat().every((value) => value === -1)).toBe(true);
    expect(result.tileData.terrain.slice(0, 21).flat().every((value) => value === -1)).toBe(true);
  });

  const cases = [
    ['wampos95.inactive-window', 5, 6, 'H10', 'D2'],
    ['wampos95.alert', 3, 3, 'H3', 'D5'],
    ['wampos95.start-bar', 8, 1, 'K10', null],
  ] as const;
  it.each(cases)('round-trips %s at its minimum on every layer, including complete clipboard copies', (brushId, width, height, corner, fill) => {
    for (const layer of ['background', 'terrain', 'foreground'] as const) {
      const result = paint(empty(), 2, 2, width, height, layer, brushId);
      expect(result.tileData[layer][height + 1][width + 1]).toBe(tile(corner));
      expect(Object.keys(result.smartTerrain.ownedOutputs)).toHaveLength(width * height);
      const restored = { ...result, smartTerrain: normalizeRoomSmartTerrainState(JSON.parse(JSON.stringify(result.smartTerrain))) };
      expect(resolveSmartRecipeDocument(restored)).toEqual(result);
      expect(paint(result, 2, 2, width - 1, height, layer, brushId)).toEqual(result);
      const clipboard = buildEditorClipboardState(layer, 2, 2, width + 1, height + 1, (x, y) => result.tileData[layer][y][x], undefined, result.smartTerrain)!;
      const plan = planEditorSmartClipboardPaste(clipboard, 20, 10, layer);
      expect(plan.recipes).toHaveLength(1);
      const controller = new SmartTileController(() => ({ brushId, styleId: 'wampos95', sourceLayer: layer }));
      const pasted = controller.applyClipboardPlan(result, plan);
      expect(pasted.tileData[layer][10 + height - 1][20 + width - 1]).toBe(tile(corner));
      if (fill) expect(pasted.tileData[layer === 'terrain' ? 'background' : layer][brushId === 'wampos95.alert' ? 11 : 13][21]).toBe(tile(fill));
      expect(resolveSmartRecipeDocument(pasted)).toEqual(pasted);
      expect(planSmartRecipeLayerClear(pasted.smartTerrain, layer).removedOutputs).toHaveLength(width * height * 2);
    }
  });

  it('rejects multi-row Start Bars and resizes a bar without disturbing a separate alert', () => {
    const alert = paint(empty(), 2, 2, 9, 6, 'terrain', 'wampos95.alert');
    expect(paint(alert, 0, 20, 20, 2, 'terrain', 'wampos95.start-bar')).toEqual(alert);
    const initial = paint(alert, 0, 21, 40, 1, 'terrain', 'wampos95.start-bar');
    const shorter = paint(initial, 0, 21, 12, 1, 'terrain', 'wampos95.start-bar');
    expect(Object.keys(shorter.smartTerrain.recipes)).toHaveLength(2);
    expect(shorter.tileData.terrain[21][11]).toBe(tile('K10'));
    expect(shorter.tileData.terrain[21].slice(12)).toEqual(Array(28).fill(-1));
    expect(shorter.tileData.terrain.slice(0, 21)).toEqual(alert.tileData.terrain.slice(0, 21));
  });

  it('replaces one window variant with another, preserving manually placed contents', () => {
    const initial = paint(empty(), 2, 2, 9, 6, 'terrain', 'wampos95.alert');
    initial.tileData.terrain[5][4] = tile('N7');
    const inactive = paint(initial, 2, 2, 12, 10, 'terrain', 'wampos95.inactive-window');
    expect(Object.values(inactive.smartTerrain.recipes).map((r) => r.brushId)).toEqual(['wampos95.inactive-window']);
    expect(inactive.tileData.terrain[5][4]).toBe(tile('N7'));
    const alert = paint(inactive, 2, 2, 9, 6, 'terrain', 'wampos95.alert');
    expect(Object.values(alert.smartTerrain.recipes).map((r) => r.brushId)).toEqual(['wampos95.alert']);
    expect(alert.tileData.terrain[11][13]).toBe(-1);
    expect(alert.tileData.background[9][10]).toBe(-1);
  });
});
