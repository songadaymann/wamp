import Phaser from 'phaser';
import {
  encodeTileDataValue,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  editorState,
  type LayerName,
  type PlacedObject,
} from '../../config';
import {
  clearSmartRecipeLayerState,
  planSmartRecipeLayerClear,
} from '../../autotiling/recipeSolver';
import {
  cloneRoomSmartTerrainState,
  createRoomSmartTerrainState,
  smartDecorationSlotKey,
  type RoomSmartTerrainState,
} from '../../autotiling/model';
import { removeTrianglesFromPlacedObjects } from './triangleDelete';

interface TileAction {
  layer: LayerName;
  x: number;
  y: number;
  oldGid: number;
  newGid: number;
}

interface ObjectsAction {
  previous: PlacedObject[];
  next: PlacedObject[];
}

export interface EditRuntimeTileClearHost {
  guardEditable(): boolean;
  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer>;
  getPlacedObjects(): PlacedObject[];
  setPlacedObjects(placedObjects: PlacedObject[]): void;
  rebuildObjectSprites(): void;
  getSmartTerrain(): RoomSmartTerrainState;
  setSmartTerrain(smartTerrain: RoomSmartTerrainState): void;
  recordTileHistory(entry: {
    actions: TileAction[];
    smartBefore: RoomSmartTerrainState;
    smartAfter: RoomSmartTerrainState;
    objects?: ObjectsAction;
  }): void;
  markRoomDirty(): void;
}

function removeTriangles(
  host: EditRuntimeTileClearHost,
  layers: readonly LayerName[],
): ObjectsAction | null {
  const result = removeTrianglesFromPlacedObjects(host.getPlacedObjects(), layers);
  if (!result) return null;
  host.setPlacedObjects(result.next);
  host.rebuildObjectSprites();
  return result;
}

/** Clear tiles (and triangles) on the active editor layer. */
export function clearCurrentEditorLayer(host: EditRuntimeTileClearHost): void {
  if (!host.guardEditable()) {
    return;
  }

  const layer = host.getLayers().get(editorState.activeLayer);
  if (!layer) {
    return;
  }

  const actions: TileAction[] = [];
  let smartTerrain = host.getSmartTerrain();
  const smartBefore = cloneRoomSmartTerrainState(smartTerrain);
  const recipeClearPlan = planSmartRecipeLayerClear(smartBefore, editorState.activeLayer);
  for (const output of recipeClearPlan.removedOutputs) {
    if (output.layer === editorState.activeLayer) continue;
    const { x, y } = output;
    const outputLayer = host.getLayers().get(output.layer);
    const outputTile = outputLayer?.getTileAt(x, y);
    const oldGid = outputTile
      ? encodeTileDataValue(outputTile.index, outputTile.flipX, outputTile.flipY)
      : -1;
    if (oldGid !== output.value) continue;
    outputLayer?.removeTileAt(x, y);
    actions.push({ layer: output.layer, x, y, oldGid, newGid: -1 });
  }
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const existingTile = layer.getTileAt(x, y);
      if (!existingTile) {
        continue;
      }

      actions.push({
        layer: editorState.activeLayer,
        x,
        y,
        oldGid: encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY),
        newGid: -1,
      });
      layer.removeTileAt(x, y);
    }
  }

  if (editorState.activeLayer === 'terrain') {
    for (const generated of [
      smartTerrain.generatedDecorations,
      smartTerrain.generatedBackgroundDecorations,
    ]) {
      for (const [targetKey, decoration] of Object.entries(generated)) {
        const [x, y] = targetKey.split(',').map(Number);
        const detailLayer = host.getLayers().get(decoration.layer);
        const tile = detailLayer?.getTileAt(x, y);
        const encoded = tile
          ? encodeTileDataValue(tile.index, tile.flipX, tile.flipY)
          : -1;
        if (!tile || encoded !== (decoration.value ?? decoration.gid)) continue;
        detailLayer?.removeTileAt(x, y);
        actions.push({ layer: decoration.layer, x, y, oldGid: encoded, newGid: -1 });
      }
    }
    smartTerrain.cells = {};
    smartTerrain.generatedDecorations = {};
    smartTerrain.generatedBackgroundDecorations = {};
    smartTerrain.suppressedDecorationSlots = [];
  } else if (editorState.activeLayer === 'foreground' || editorState.activeLayer === 'background') {
    if (editorState.activeLayer === 'background') smartTerrain.backdropCells = {};
    for (const generated of [
      smartTerrain.generatedDecorations,
      smartTerrain.generatedBackgroundDecorations,
    ]) {
      for (const [targetKey, decoration] of Object.entries(generated)) {
        if (decoration.layer !== editorState.activeLayer) continue;
        smartTerrain.suppressedDecorationSlots = Array.from(new Set([
          ...smartTerrain.suppressedDecorationSlots,
          smartDecorationSlotKey(decoration.ownerKey, decoration.slot),
        ]));
        delete generated[targetKey];
      }
    }
  }
  smartTerrain = clearSmartRecipeLayerState(smartTerrain, editorState.activeLayer);
  host.setSmartTerrain(smartTerrain);
  const triangles = removeTriangles(host, [editorState.activeLayer]);
  if (actions.length === 0 && !triangles && JSON.stringify(smartBefore) === JSON.stringify(smartTerrain)) {
    return;
  }
  host.recordTileHistory({
    actions,
    smartBefore,
    smartAfter: cloneRoomSmartTerrainState(smartTerrain),
    ...(triangles ? { objects: triangles } : {}),
  });
  host.markRoomDirty();
}

/** Clear every tile layer and all triangles. */
export function clearAllEditorTiles(host: EditRuntimeTileClearHost): void {
  if (!host.guardEditable()) {
    return;
  }

  const actions: TileAction[] = [];
  const smartBefore = cloneRoomSmartTerrainState(host.getSmartTerrain());
  for (const layerName of LAYER_NAMES) {
    const layer = host.getLayers().get(layerName);
    if (!layer) {
      continue;
    }

    for (let y = 0; y < ROOM_HEIGHT; y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const existingTile = layer.getTileAt(x, y);
        if (!existingTile) {
          continue;
        }

        actions.push({
          layer: layerName,
          x,
          y,
          oldGid: encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY),
          newGid: -1,
        });
        layer.removeTileAt(x, y);
      }
    }
  }

  const clearedSmartTerrain = createRoomSmartTerrainState();
  const triangles = removeTriangles(host, LAYER_NAMES);
  if (actions.length === 0 && !triangles && JSON.stringify(smartBefore) === JSON.stringify(clearedSmartTerrain)) {
    return;
  }

  host.setSmartTerrain(clearedSmartTerrain);
  host.recordTileHistory({
    actions,
    smartBefore,
    smartAfter: cloneRoomSmartTerrainState(clearedSmartTerrain),
    ...(triangles ? { objects: triangles } : {}),
  });
  host.markRoomDirty();
}
