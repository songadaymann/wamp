import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAYER_NAMES,
  TILE_SIZE,
  editorState,
  encodeTileDataValue,
  getObjectById,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import { CUSTOM_ROOM_TILE_FIRST_GID, type CustomRoomTileDefinition } from '../../customTiles/model';
import { getPlacedObjectAnchorCell } from '../../placedObjects/occupancy';
import { EditorEditRuntime } from './editRuntime';
import { planClipboardCustomTiles, planClipboardObjectPaste, remapClipboardTileValue } from './clipboardObjects';
import { loadEditorClipboard, saveEditorClipboard } from './clipboardStorage';

vi.mock('phaser', () => ({ default: { Geom: { Rectangle: class Rectangle {} } } }));
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

class FakeLayer {
  private readonly tiles = new Map<string, { index: number; flipX: boolean; flipY: boolean }>();
  getTileAt(x: number, y: number) { return this.tiles.get(`${x},${y}`) ?? null; }
  putTileAt(index: number, x: number, y: number) { const tile = { index, flipX: false, flipY: false }; this.tiles.set(`${x},${y}`, tile); return tile; }
  removeTileAt(x: number, y: number): void { this.tiles.delete(`${x},${y}`); }
}

function harness(room: RoomSnapshot) {
  const layers = new Map<LayerName, FakeLayer>(LAYER_NAMES.map((name) => [name, new FakeLayer()]));
  let placedObjects: PlacedObject[] = [];
  const host = {
    getLayers: () => layers, getTilemap: () => ({}),
    getRoomSnapshotMetadata: () => ({ roomId: room.id, coordinates: room.coordinates, title: room.title, version: room.version,
      createdAt: room.createdAt, updatedAt: room.updatedAt, publishedAt: room.publishedAt }),
    getRoomOrigin: () => ({ x: 0, y: 0 }),
    getSelectedBackground: () => room.background, setSelectedBackground: vi.fn(),
    getSelectedLightingSettings: () => room.lighting, setSelectedLightingSettings: vi.fn(),
    getSelectedWeatherSettings: () => room.weather, setSelectedWeatherSettings: vi.fn(),
    getPlacedObjects: () => placedObjects, setPlacedObjects: (next: PlacedObject[]) => { placedObjects = next; },
    updateBackgroundSelectValue: vi.fn(), updateLightingControlsValue: vi.fn(), updateWeatherControlsValue: vi.fn(),
    updateBackground: vi.fn(), updateGoalUi: vi.fn(), syncBackgroundCameraIgnores: vi.fn(),
    updatePersistenceStatus: vi.fn(), canSaveDraft: () => true, recordBuildPlacement: vi.fn(),
  };
  const runtime = new EditorEditRuntime({} as never, host as never);
  runtime.reset();
  runtime.applyRoomSnapshot(room);
  return { runtime, layers, host, objects: () => placedObjects };
}

/** A placed object whose anchor cell is (tileX, tileY). */
function at(id: string, instanceId: string, tileX: number, tileY: number, extra: Partial<PlacedObject> = {}): PlacedObject {
  const config = getObjectById(id)!;
  return { id, instanceId, x: tileX * TILE_SIZE + config.frameWidth / 2, y: tileY * TILE_SIZE + TILE_SIZE - config.frameHeight / 2, ...extra };
}

function room(x: number, y: number, objects: PlacedObject[] = [], customTiles: CustomRoomTileDefinition[] = []): RoomSnapshot {
  const snapshot = createDefaultRoomSnapshot(`${x},${y}`, { x, y });
  snapshot.placedObjects = objects;
  snapshot.customTiles = customTiles;
  return snapshot;
}

const tile = (id: string, colour: string, sourceSpriteId: string | null = null): CustomRoomTileDefinition => ({
  // Room loading accepts #rrggbb pixels only.
  id, name: id, pixels: Array.from({ length: 256 }, () => colour), collision: 'solid', sourceSpriteId, createdAt: '', updatedAt: '',
});

function storageStub() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: storageStub(), dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  editorState.activeLayer = 'terrain';
  editorState.paletteMode = 'tiles';
});
afterEach(() => vi.unstubAllGlobals());

describe('object clipboard planning', () => {
  it('re-links copies to each other, drops links to uncopied objects, and skips occupied or off-room spots', () => {
    const plate = at('floor_trigger', 'plate', 0, 0, { triggerTargetInstanceId: 'door' });
    const door = at('door_metal', 'door', 2, 0);
    const lonely = at('floor_trigger', 'lonely', 4, 0, { triggerTargetInstanceId: 'elsewhere' });
    let n = 0;
    const plan = planClipboardObjectPaste([plate, door, lonely], [at('coin_gold', 'blocker', 30, 5)], 10, 5, () => `new-${++n}`);
    expect(plan.added.map((placed) => placed.instanceId)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(plan.added[0].triggerTargetInstanceId).toBe('new-2');
    expect(plan.added[2].triggerTargetInstanceId).toBeNull();
    expect(plan.droppedLinks).toBe(1);
    expect(getPlacedObjectAnchorCell(plan.added[1])).toMatchObject({ tileX: 12, tileY: 5 });

    const blocked = planClipboardObjectPaste([plate, door], [at('coin_gold', 'blocker', 10, 5)], 10, 5, () => 'x');
    // The plate's spot is taken, so only the door lands.
    expect(blocked.skipped).toBe(1);
    expect(blocked.added.map((placed) => placed.id)).toEqual(['door_metal']);
    expect(planClipboardObjectPaste([door], [], 39, 0, () => 'y').skipped).toBe(1);
  });

  it('reuses matching custom tiles, appends new ones, keeps flips and empties unmappable tiles', () => {
    const copied = [{ gid: 10_003, tile: tile('a', '#f00') }, { gid: 10_007, tile: tile('b', '#0f0', 'sprite-b') }];
    const target = [tile('other', '#00f'), tile('b-copy', '#123', 'sprite-b')];
    const { gidMap, additions } = planClipboardCustomTiles(copied, target);
    expect(gidMap.get(10_007)).toBe(CUSTOM_ROOM_TILE_FIRST_GID + 1);
    expect(gidMap.get(10_003)).toBe(CUSTOM_ROOM_TILE_FIRST_GID + 2);
    expect(additions.map((t) => t.id)).toEqual(['a']);
    expect(remapClipboardTileValue(encodeTileDataValue(10_003, true, false), gidMap)).toBe(encodeTileDataValue(CUSTOM_ROOM_TILE_FIRST_GID + 2, true, false));
    expect(remapClipboardTileValue(42, gidMap)).toBe(42);
    const full = Array.from({ length: 128 }, (_, i) => tile(`t${i}`, `#${i}`));
    expect(planClipboardCustomTiles([{ gid: 10_003, tile: tile('a', '#f00') }], full).gidMap.get(10_003)).toBeNull();
  });
});

describe('clipboard storage', () => {
  it('round-trips a clipboard and ignores corrupt or oversized data', () => {
    const storage = storageStub();
    const state = { sourceLayer: 'terrain' as const, width: 1, height: 1, tiles: [[5]], occupiedMask: [[true]], objects: [at('coin_gold', 'c', 0, 0)] };
    saveEditorClipboard(state, storage);
    expect(loadEditorClipboard(storage)).toEqual(state);
    storage.setItem('wamp_editor_clipboard_v1', '{"width":"nope"}');
    expect(loadEditorClipboard(storage)).toBeNull();
    saveEditorClipboard({ ...state, tiles: [[1]], objects: [{ ...state.objects[0], signText: 'x'.repeat(2_000_000) }] }, storage);
    expect(loadEditorClipboard(storage)).toBeNull();
  });
});

describe('copy and paste with objects', () => {
  it('pastes tiles and linked objects as one Undo step', () => {
    const plate = at('floor_trigger', 'plate', 2, 10, { triggerTargetInstanceId: 'door' });
    const door = at('door_metal', 'door', 4, 10);
    const outside = at('coin_gold', 'outside', 20, 10);
    const { runtime, layers, objects } = harness(room(0, 0, [plate, door, outside]));
    runtime.beginTileBatch(); runtime.placeTileAt(2 * TILE_SIZE, 11 * TILE_SIZE); runtime.commitTileBatch();
    expect(runtime.copyTilesToClipboard(1, 9, 5, 11)).toBe(true);
    expect(runtime.currentClipboardState?.objects?.map((placed) => placed.instanceId)).toEqual(['plate', 'door']);

    runtime.beginTileBatch();
    expect(runtime.pasteClipboardAt(10, 3)).toBe(true);
    runtime.commitTileBatch();
    const pasted = objects().filter((placed) => !['plate', 'door', 'outside'].includes(placed.instanceId));
    expect(pasted).toHaveLength(2);
    const [newPlate, newDoor] = pasted;
    expect(newPlate.triggerTargetInstanceId).toBe(newDoor.instanceId);
    expect(getPlacedObjectAnchorCell(newDoor)).toMatchObject({ tileX: 13, tileY: 4 });
    expect(layers.get('terrain')!.getTileAt(11, 5)).not.toBeNull();

    runtime.undo();
    expect(objects().map((placed) => placed.instanceId).sort()).toEqual(['door', 'outside', 'plate']);
    expect(layers.get('terrain')!.getTileAt(11, 5)).toBeNull();
    expect(layers.get('terrain')!.getTileAt(2, 11)).not.toBeNull();
    runtime.redo();
    expect(objects()).toHaveLength(5);
    expect(layers.get('terrain')!.getTileAt(11, 5)).not.toBeNull();
  });

  it('copies an area that holds only objects', () => {
    const { runtime, objects } = harness(room(0, 0, [at('coin_gold', 'coin', 5, 5)]));
    expect(runtime.copyTilesToClipboard(4, 4, 6, 6)).toBe(true);
    runtime.beginTileBatch();
    expect(runtime.pasteClipboardAt(20, 10)).toBe(true);
    runtime.commitTileBatch();
    expect(objects().map((placed) => getPlacedObjectAnchorCell(placed))).toContainEqual(expect.objectContaining({ tileX: 21, tileY: 11 }));
    expect(runtime.copyTilesToClipboard(30, 15, 31, 16)).toBe(false);
  });

  it('carries the clipboard to another room, recreating the custom tiles it uses', () => {
    const a = harness(room(0, 0, [at('coin_gold', 'coin', 1, 1)], [tile('art', '#aabbcc')]));
    const customGid = CUSTOM_ROOM_TILE_FIRST_GID;
    editorState.selectedTileGid = customGid;
    a.layers.get('terrain')!.putTileAt(customGid, 1, 2);
    expect(a.runtime.copyTilesToClipboard(0, 0, 2, 2)).toBe(true);

    // Opening another room loads the shared clipboard rather than clearing it.
    const b = harness(room(1, 0, [], [tile('mine', '#999999')]));
    expect(b.runtime.hasClipboardTiles()).toBe(true);
    b.runtime.beginTileBatch();
    expect(b.runtime.pasteClipboardAt(10, 10)).toBe(true);
    b.runtime.commitTileBatch();
    const exported = b.runtime.exportRoomSnapshot();
    expect(exported.customTiles?.map((t) => t.id)).toEqual(['mine', 'art']);
    expect(b.layers.get('terrain')!.getTileAt(11, 12)?.index).toBe(CUSTOM_ROOM_TILE_FIRST_GID + 1);
    expect(b.objects()).toHaveLength(1);
    expect(b.objects()[0].instanceId).not.toBe('coin');
  });
});
