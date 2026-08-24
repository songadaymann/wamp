import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  editorState,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { createDefaultRoomMusic, createDefaultRoomPatternMusic } from '../../music/model';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
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

    runtime.beginTileBatch();
    runtime.stampShape('line', 10, 0, 13, 0, { erase: false });
    runtime.commitTileBatch();
    expect(terrain.getTileAt(10, 0)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(11, 0)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(12, 0)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(13, 0)?.index).toBeTypeOf('number');

    runtime.beginTileBatch();
    runtime.stampShape('curve', 20, 10, 24, 10, { erase: false, mid: { x: 22, y: 12 } });
    runtime.commitTileBatch();
    expect(terrain.getTileAt(20, 10)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(24, 10)?.index).toBeTypeOf('number');
    expect(terrain.getTileAt(22, 12)?.index).toBeTypeOf('number');
  });
});

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
