import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { createDefaultRoomMusic, createDefaultRoomPatternMusic } from '../../music/model';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import type { SmartBrushId } from '../../autotiling/model';
import { EditorEditRuntime } from './editRuntime';

vi.mock('phaser', () => ({
  default: {
    Geom: { Rectangle: class Rectangle {} },
  },
}));

vi.mock('../../customTiles/runtime', () => ({
  buildCustomRoomTileTextureKey: vi.fn(() => 'test-custom-tiles'),
  ensureCustomRoomTileTexture: vi.fn(),
  syncCustomRoomTilesetForLayers: vi.fn(),
}));

vi.mock('./documentPresentationController', () => ({
  EditorDocumentPresentationController: class {
    readonly placedObjectSprites = [];
    readonly currentSpawnMarkerSprite = null;
    readonly currentGoalMarkerSprites = [];
    readonly currentGoalMarkerLabels = [];
    reset(): void {}
    rebuild(): void {}
  },
}));

describe('editor edit runtime document contracts', () => {
  beforeEach(() => {
    editorState.activeLayer = 'terrain';
    editorState.activeTool = 'pencil';
    editorState.paletteMode = 'tiles';
    editorState.smartTheme = 'forest';
    editorState.smartMaterial = 'forest.ground';
    editorState.selectedTileGid = 1;
    editorState.selection = {
      tilesetKey: 'essentials',
      startCol: 0,
      startRow: 0,
      width: 1,
      height: 1,
      occupiedMask: [[true]],
    };
    editorState.tileFlipX = false;
    editorState.tileFlipY = false;
    editorState.selectedObjectId = null;
  });

  it('round-trips tile, object, spawn, goal, music, and metadata document state', () => {
    const room = createRoom();
    room.title = 'Characterization Room';
    room.tileData.terrain[2][3] = 1;
    room.placedObjects = [object('coin-1')];
    room.spawnPoint = { x: 40, y: 64 };
    room.goal = { type: 'reach_exit', exit: { x: 80, y: 96 }, timeLimitMs: 5000 };
    room.goalIntroText = '  Reach   the flag!  ';
    room.music = createDefaultRoomMusic();

    const { runtime } = createHarness(room);
    const exported = runtime.exportRoomSnapshot();
    expect(exported).toMatchObject({
      id: room.id,
      coordinates: room.coordinates,
      title: room.title,
      goalIntroText: 'Reach the flag!',
      spawnPoint: room.spawnPoint,
      goal: room.goal,
      music: room.music,
      placedObjects: room.placedObjects,
    });
    expect(exported.tileData.terrain[2][3]).toBe(1);
    expect(runtime.isRoomDirty).toBe(false);
    expect(runtime.hasUndoHistory()).toBe(false);
  });

  it('treats omitted overview tile rows as empty while the full room loads', () => {
    const room = createRoom();
    room.tileData.foreground = [];

    const { runtime } = createHarness(room);
    const exported = runtime.exportRoomSnapshot();

    expect(exported.tileData.foreground).toHaveLength(ROOM_HEIGHT);
    expect(exported.tileData.foreground).toEqual(
      Array.from({ length: ROOM_HEIGHT }, () => Array(ROOM_WIDTH).fill(-1)),
    );
  });

  it('applies Undo and Redo for tiles, objects, spawn, goals, and music', () => {
    const { runtime, layers, host } = createHarness(createRoom());
    const terrain = layers.get('terrain')!;

    runtime.beginTileBatch();
    runtime.placeTileAt(16, 16);
    runtime.commitTileBatch();
    const placedTileIndex = terrain.getTileAt(1, 1)?.index;
    expect(placedTileIndex).toBeTypeOf('number');
    runtime.undo();
    expect(terrain.getTileAt(1, 1)).toBeNull();
    runtime.redo();
    expect(terrain.getTileAt(1, 1)?.index).toBe(placedTileIndex);

    host.setPlacedObjects([object('coin-1')]);
    runtime.clearAllObjects();
    expect(host.getPlacedObjects()).toEqual([]);
    runtime.undo();
    expect(host.getPlacedObjects().map(({ instanceId }) => instanceId)).toEqual(['coin-1']);
    runtime.redo();
    expect(host.getPlacedObjects()).toEqual([]);

    editorState.selectedObjectId = 'spawn_point';
    runtime.handleObjectPlace(24, 32, 1, 1);
    expect(runtime.currentRoomSpawnPoint).toEqual({ x: 24, y: 32 });
    runtime.undo();
    expect(runtime.currentRoomSpawnPoint).toBeNull();
    runtime.redo();
    expect(runtime.currentRoomSpawnPoint).toEqual({ x: 24, y: 32 });

    runtime.setGoalType('survival');
    expect(runtime.currentRoomGoal?.type).toBe('survival');
    runtime.undo();
    expect(runtime.currentRoomGoal).toBeNull();
    runtime.redo();
    expect(runtime.currentRoomGoal?.type).toBe('survival');

    const music = createDefaultRoomPatternMusic();
    music.tabs.drums['kick-1'].push(0);
    runtime.setRoomMusic(music);
    expect(runtime.currentRoomMusic).not.toBeNull();
    runtime.undo();
    expect(runtime.currentRoomMusic).toBeNull();
    runtime.redo();
    expect(runtime.currentRoomMusic).not.toBeNull();
  });

  it('blocks edits while read-only and preserves dirty/status semantics when editable', () => {
    const { runtime, host, setEditable } = createHarness(createRoom());
    setEditable(false);
    runtime.setGoalType('survival');
    runtime.beginTileBatch();
    runtime.placeTileAt(16, 16);
    runtime.commitTileBatch();
    expect(runtime.currentRoomGoal).toBeNull();
    expect(runtime.isRoomDirty).toBe(false);
    expect(host.updatePersistenceStatus).toHaveBeenLastCalledWith(
      'This room is read-only for this account.',
    );

    setEditable(true);
    runtime.setGoalType('survival');
    expect(runtime.isRoomDirty).toBe(true);
    expect(host.updatePersistenceStatus).toHaveBeenLastCalledWith('Draft changes...');
  });

  it('stamps filled and outline rectangles and ellipses, and flood-erases matching tiles', () => {
    const { runtime, layers } = createHarness(createRoom());
    const terrain = layers.get('terrain')!;

    runtime.beginTileBatch();
    runtime.stampShape('rect', 0, 0, 2, 2, { outline: false, erase: false });
    runtime.commitTileBatch();
    expect(countTiles(terrain)).toBe(9);

    runtime.beginTileBatch();
    runtime.stampShape('rect', 0, 0, 2, 2, { outline: true, erase: true });
    runtime.commitTileBatch();
    expect(terrain.getTileAt(1, 1)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(0, 0)).toBeNull();
    expect(countTiles(terrain)).toBe(1);

    runtime.beginTileBatch();
    runtime.stampShape('ellipse', 4, 4, 8, 8, { outline: false, erase: false });
    runtime.commitTileBatch();
    const ellipseCount = countTiles(terrain) - 1;
    expect(ellipseCount).toBeGreaterThan(4);
    expect(terrain.getTileAt(6, 6)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(4, 4)).toBeNull();

    runtime.beginTileBatch();
    runtime.floodErase(6, 6);
    runtime.commitTileBatch();
    expect(countTiles(terrain)).toBe(1);
    expect(terrain.getTileAt(1, 1)?.index).toBeTypeOf('number');
  });

  it('feeds Smart rectangle and ellipse shapes through semantic auto-tiling', () => {
    editorState.paletteMode = 'smart';
    const { runtime, layers } = createHarness(createRoom());
    const terrain = layers.get('terrain')!;

    runtime.beginTileBatch();
    runtime.stampShape('ellipse', 4, 4, 8, 8, { outline: false, erase: false });
    runtime.commitTileBatch();
    const painted = runtime.exportRoomSnapshot();
    expect(painted.smartTerrain!.cells['6,6']).toMatchObject({ theme: 'forest', material: 'ground' });
    expect(painted.smartTerrain!.semanticCells['terrain:6,6']).toMatchObject({
      styleId: 'forest', brushId: 'forest.ground',
    });
    expect(painted.smartTerrain!.cells['4,4']).toBeUndefined();
    expect(terrain.getTileAt(6, 6)?.index).toBeTypeOf('number');

    runtime.beginTileBatch();
    runtime.stampShape('ellipse', 4, 4, 8, 8, { outline: true, erase: true });
    runtime.commitTileBatch();
    const carved = runtime.exportRoomSnapshot();
    expect(carved.smartTerrain!.cells['6,6']).toMatchObject({ theme: 'forest', material: 'ground' });
    expect(carved.smartTerrain!.cells['6,4']).toBeUndefined();
    expect(terrain.getTileAt(6, 4)).toBeNull();

    runtime.undo();
    const restored = runtime.exportRoomSnapshot();
    expect(restored.smartTerrain!.cells['6,4']).toMatchObject({ theme: 'forest', material: 'ground' });
    expect(terrain.getTileAt(6, 4)?.index).toBeTypeOf('number');
  });

  it('projects a diagonal Cyber Platform pencil gesture onto its anchored horizontal row', () => {
    selectCyberBrush('cyber.platform');
    const { runtime, layers, host } = createHarness(createRoom());

    runtime.beginTileBatch();
    placeSmartCell(runtime, 4, 5);
    placeSmartCell(runtime, 5, 6);
    placeSmartCell(runtime, 6, 7);
    runtime.commitTileBatch();

    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual([
      'terrain:4,5',
      'terrain:5,5',
      'terrain:6,5',
    ]);
    expect(getTileCoordinates(layers.get('terrain')!)).toEqual(['4,5', '5,5', '6,5']);
    expect(host.recordBuildPlacement).toHaveBeenCalledTimes(1);
    expect(runtime.hasUndoHistory()).toBe(true);

    runtime.undo();
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual([]);
    expect(getTileCoordinates(layers.get('terrain')!)).toEqual([]);
    expect(runtime.hasUndoHistory()).toBe(false);

    runtime.redo();
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual([
      'terrain:4,5',
      'terrain:5,5',
      'terrain:6,5',
    ]);
    expect(getTileCoordinates(layers.get('terrain')!)).toEqual(['4,5', '5,5', '6,5']);
  });

  it('collapses a vertical Cyber Neon Strip pencil gesture to its anchored source cell', () => {
    selectCyberBrush('cyber.neon-strip');
    const { runtime, layers } = createHarness(createRoom());

    runtime.beginTileBatch();
    placeSmartCell(runtime, 9, 3);
    placeSmartCell(runtime, 9, 4);
    placeSmartCell(runtime, 9, 5);
    placeSmartCell(runtime, 9, 6);
    runtime.commitTileBatch();

    expect(getSmartSourceKeys(runtime, 'cyber.neon-strip')).toEqual(['terrain:9,3']);
    expect(getTileCoordinates(layers.get('terrain')!)).toEqual([]);
  });

  it('projects a diagonal Cyber Support pencil gesture onto its anchored vertical column', () => {
    selectCyberBrush('cyber.support');
    const { runtime, layers } = createHarness(createRoom());

    runtime.beginTileBatch();
    placeSmartCell(runtime, 15, 3);
    placeSmartCell(runtime, 16, 4);
    placeSmartCell(runtime, 17, 5);
    runtime.commitTileBatch();

    expect(getSmartSourceKeys(runtime, 'cyber.support')).toEqual([
      'background:15,3',
      'background:15,4',
      'background:15,5',
    ]);
    expect(getTileCoordinates(layers.get('background')!)).toEqual(['15,3', '15,4', '15,5']);
  });

  it('normalizes Cyber path rectangles, preserves Support banks, and keeps panels two rows high', () => {
    const { runtime, layers } = createHarness(createRoom());

    selectCyberBrush('cyber.platform');
    runtime.beginTileBatch();
    runtime.stampShape('rect', 2, 3, 6, 8, { outline: false, erase: false });
    runtime.commitTileBatch();

    selectCyberBrush('cyber.neon-strip');
    runtime.beginTileBatch();
    runtime.stampShape('rect', 8, 9, 12, 4, { outline: false, erase: false });
    runtime.commitTileBatch();

    selectCyberBrush('cyber.support');
    runtime.beginTileBatch();
    runtime.stampShape('rect', 18, 2, 22, 7, { outline: false, erase: false });
    runtime.commitTileBatch();

    selectCyberBrush('cyber.framed-panel');
    runtime.beginTileBatch();
    runtime.stampShape('rect', 24, 12, 29, 17, { outline: false, erase: false });
    runtime.commitTileBatch();

    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual(
      [2, 3, 4, 5, 6].map((x) => `terrain:${x},3`),
    );
    expect(getSmartSourceKeys(runtime, 'cyber.neon-strip')).toEqual(
      [8, 9, 10, 11, 12].map((x) => `terrain:${x},9`),
    );
    expect(getSmartSourceKeys(runtime, 'cyber.support')).toEqual(
      [18, 19, 20, 21, 22]
        .flatMap((x) => [2, 3, 4, 5, 6, 7].map((y) => `background:${x},${y}`))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    );

    const snapshot = runtime.exportRoomSnapshot();
    const panelRecipe = Object.values(snapshot.smartTerrain!.recipes).find(
      (recipe) => recipe.brushId === 'cyber.framed-panel',
    );
    expect(panelRecipe).toMatchObject({
      anchor: { layer: 'foreground', x: 24, y: 12 },
      parameters: { width: 6, height: 2 },
    });
    expect(panelRecipe?.sourceCells).toEqual(
      [24, 25, 26, 27, 28, 29].map((x) => ({ layer: 'foreground', x, y: 12 })),
    );

    expect(getTileCoordinates(layers.get('terrain')!)).toEqual([
      '2,3', '3,3', '4,3', '5,3', '6,3',
      '8,9', '9,9', '10,9', '11,9', '12,9',
    ]);
    expect(getTileCoordinates(layers.get('background')!)).toEqual([
      '18,2', '19,2', '20,2', '21,2', '22,2',
      '18,3', '19,3', '20,3', '21,3', '22,3',
      '18,4', '19,4', '20,4', '21,4', '22,4',
      '18,5', '19,5', '20,5', '21,5', '22,5',
      '18,6', '19,6', '20,6', '21,6', '22,6',
      '18,7', '19,7', '20,7', '21,7', '22,7',
    ]);
    expect(getTileCoordinates(layers.get('foreground')!)).toEqual([
      '24,12', '25,12', '26,12', '27,12', '28,12', '29,12',
      '24,13', '25,13', '26,13', '27,13', '28,13', '29,13',
    ]);
  });

  it('round-trips complete Cyber span recipes through clipboard, undo, redo, and export', () => {
    selectCyberBrush('cyber.platform');
    const { runtime, layers } = createHarness(createRoom());

    runtime.beginTileBatch();
    runtime.stampShape('rect', 4, 5, 6, 5, { outline: false, erase: false });
    runtime.commitTileBatch();
    const originalRecipe = Object.entries(runtime.exportRoomSnapshot().smartTerrain!.recipes)
      .find(([, recipe]) => recipe.brushId === 'cyber.platform');
    expect(originalRecipe).toBeDefined();
    expect(runtime.copyTilesToClipboard(4, 5, 6, 5)).toBe(true);

    runtime.beginTileBatch();
    expect(runtime.pasteClipboardAt(12, 9)).toBe(true);
    runtime.commitTileBatch();

    const pasted = runtime.exportRoomSnapshot();
    const platformRecipes = Object.entries(pasted.smartTerrain!.recipes)
      .filter(([, recipe]) => recipe.brushId === 'cyber.platform');
    expect(platformRecipes).toHaveLength(2);
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual([
      'terrain:4,5', 'terrain:5,5', 'terrain:6,5',
      'terrain:12,9', 'terrain:13,9', 'terrain:14,9',
    ]);
    const copiedRecipe = platformRecipes.find(([instanceId]) => instanceId !== originalRecipe![0]);
    expect(copiedRecipe?.[1]).toMatchObject({
      ownerId: `cyber:recipe:${copiedRecipe?.[0]}`,
      anchor: { layer: 'terrain', x: 12, y: 9 },
      bounds: { minX: 12, minY: 9, maxX: 14, maxY: 9, width: 3, height: 1 },
    });

    const reloaded = createHarness(pasted).runtime;
    expect(getSmartSourceKeys(reloaded, 'cyber.platform')).toEqual(
      getSmartSourceKeys(runtime, 'cyber.platform'),
    );
    expect(reloaded.exportRoomSnapshot().smartTerrain!.ownedOutputs).toEqual(
      pasted.smartTerrain!.ownedOutputs,
    );

    runtime.undo();
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual([
      'terrain:4,5', 'terrain:5,5', 'terrain:6,5',
    ]);
    expect(getTileCoordinates(layers.get('terrain')!)).toEqual(['4,5', '5,5', '6,5']);

    runtime.redo();
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toEqual([
      'terrain:4,5', 'terrain:5,5', 'terrain:6,5',
      'terrain:12,9', 'terrain:13,9', 'terrain:14,9',
    ]);

    expect(runtime.copyTilesToClipboard(4, 5, 5, 5)).toBe(true);
    runtime.beginTileBatch();
    expect(runtime.pasteClipboardAt(20, 12)).toBe(true);
    runtime.commitTileBatch();
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).not.toContain('terrain:20,12');
    expect(getTileCoordinates(layers.get('terrain')!)).toContain('20,12');
    expect(getTileCoordinates(layers.get('terrain')!)).toContain('21,12');

    runtime.undo();
    expect(getTileCoordinates(layers.get('terrain')!)).not.toContain('20,12');
    expect(getSmartSourceKeys(runtime, 'cyber.platform')).toHaveLength(6);
  });
});

function selectCyberBrush(brushId: SmartBrushId): void {
  editorState.paletteMode = 'smart';
  editorState.smartTheme = 'cyber';
  editorState.smartStyle = 'cyber-yellow';
  editorState.smartMaterial = brushId;
}

function placeSmartCell(runtime: EditorEditRuntime, x: number, y: number): void {
  runtime.placeTileAt(x * TILE_SIZE, y * TILE_SIZE);
}

function getSmartSourceKeys(runtime: EditorEditRuntime, brushId: SmartBrushId): string[] {
  const smartTerrain = runtime.exportRoomSnapshot().smartTerrain!;
  return Object.values(smartTerrain.recipes)
    .filter((recipe) => recipe.brushId === brushId)
    .flatMap((recipe) => recipe.sourceCells.map(({ layer, x, y }) => `${layer}:${x},${y}`))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function getTileCoordinates(layer: FakeLayer): string[] {
  const coordinates: string[] = [];
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      if (layer.getTileAt(x, y)) coordinates.push(`${x},${y}`);
    }
  }
  return coordinates;
}

function countTiles(layer: FakeLayer): number {
  let count = 0;
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      if (layer.getTileAt(x, y)) {
        count += 1;
      }
    }
  }
  return count;
}

function createHarness(room: RoomSnapshot) {
  const layers = new Map<LayerName, FakeLayer>(
    LAYER_NAMES.map((layerName) => [layerName, new FakeLayer()]),
  );
  let placedObjects: PlacedObject[] = [];
  let editable = true;
  const host = {
    getLayers: () => layers,
    getTilemap: () => ({}),
    getRoomSnapshotMetadata: () => ({
      roomId: room.id,
      coordinates: room.coordinates,
      title: room.title,
      version: room.version,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      publishedAt: room.publishedAt,
    }),
    getRoomOrigin: () => ({ x: 0, y: 0 }),
    getSelectedBackground: () => room.background,
    setSelectedBackground: vi.fn(),
    getSelectedLightingSettings: () => room.lighting,
    setSelectedLightingSettings: vi.fn(),
    getSelectedWeatherSettings: () => room.weather,
    setSelectedWeatherSettings: vi.fn(),
    getPlacedObjects: () => placedObjects,
    setPlacedObjects: (next: PlacedObject[]) => {
      placedObjects = next;
    },
    updateBackgroundSelectValue: vi.fn(),
    updateLightingControlsValue: vi.fn(),
    updateWeatherControlsValue: vi.fn(),
    updateBackground: vi.fn(),
    updateGoalUi: vi.fn(),
    syncBackgroundCameraIgnores: vi.fn(),
    updatePersistenceStatus: vi.fn(),
    canSaveDraft: () => editable,
    recordBuildPlacement: vi.fn(),
  };
  const runtime = new EditorEditRuntime({} as never, host as never);
  runtime.applyRoomSnapshot(room);
  return {
    runtime,
    layers,
    host,
    setEditable: (next: boolean) => {
      editable = next;
    },
  };
}

function createRoom(): RoomSnapshot {
  return createDefaultRoomSnapshot('4,2', { x: 4, y: 2 });
}

function object(instanceId: string): PlacedObject {
  return { id: 'coin_gold', instanceId, x: 24, y: 32, linkedTargetInstanceIds: null };
}

interface FakeTile {
  index: number;
  flipX: boolean;
  flipY: boolean;
}

class FakeLayer {
  private readonly tiles = new Map<string, FakeTile>();

  getTileAt(x: number, y: number): FakeTile | null {
    return this.tiles.get(`${x},${y}`) ?? null;
  }

  putTileAt(index: number, x: number, y: number): FakeTile {
    const tile = { index, flipX: false, flipY: false };
    this.tiles.set(`${x},${y}`, tile);
    return tile;
  }

  removeTileAt(x: number, y: number): void {
    this.tiles.delete(`${x},${y}`);
  }
}
