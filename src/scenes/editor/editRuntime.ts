import Phaser from 'phaser';
import {
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectTriggerOtherObjects,
  createPlacedObjectInstanceId,
  decodeTileDataValue,
  encodeTileDataValue,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  getPlacedObjectLayer,
  getObjectById,
  getObjectDefaultFrame,
  placedObjectContributesToCategory,
  getSelectionTileValue,
  type LayerName,
  type PlacedObject,
} from '../../config';
import {
  cloneRoomGoal,
  createDefaultRoomGoal,
  createGoalMarkerPointFromTile,
  goalSupportsTimeLimit,
  type CheckpointSprintGoal,
  type GoalMarkerPoint,
  type RoomGoal,
  type RoomGoalType,
} from '../../goals/roomGoals';
import {
  createGoalMarkerFlagSprite,
  type GoalMarkerFlagVariant,
} from '../../goals/markerFlags';
import type { RoomCoordinates, RoomSnapshot, RoomSpawnPoint, RoomTileData } from '../../persistence/roomRepository';

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

interface SpawnAction {
  previous: RoomSpawnPoint | null;
  next: RoomSpawnPoint | null;
}

interface GoalAction {
  previous: RoomGoal | null;
  next: RoomGoal | null;
}

type UndoAction =
  | { kind: 'tiles'; actions: TileAction[] }
  | { kind: 'objects'; action: ObjectsAction }
  | { kind: 'spawn'; action: SpawnAction }
  | { kind: 'goal'; action: GoalAction };

export type GoalPlacementMode = 'exit' | 'checkpoint' | 'finish' | null;

interface EditorRoomSnapshotMetadata {
  roomId: string;
  coordinates: RoomCoordinates;
  title: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface EditorClipboardState {
  sourceLayer: LayerName;
  width: number;
  height: number;
  tiles: number[][];
  occupiedMask: boolean[][];
}

interface EditorEditRuntimeHost {
  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer>;
  getRoomSnapshotMetadata(): EditorRoomSnapshotMetadata;
  updateBackgroundSelectValue(backgroundId: string): void;
  updateBackground(): void;
  updateGoalUi(): void;
  syncBackgroundCameraIgnores(): void;
  updatePersistenceStatus(text: string): void;
  canSaveDraft(): boolean;
}

export class EditorEditRuntime {
  private objectSprites: Phaser.GameObjects.Sprite[] = [];
  private spawnMarkerSprite: Phaser.GameObjects.Sprite | null = null;
  private goalMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private goalMarkerLabels: Phaser.GameObjects.Text[] = [];
  private roomGoal: RoomGoal | null = null;
  private roomSpawnPoint: RoomSpawnPoint | null = null;
  private roomDirty = false;
  private lastDirtyAt = 0;
  private goalPlacementMode: GoalPlacementMode = null;
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private currentBatch: TileAction[] = [];
  private clipboardState: EditorClipboardState | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorEditRuntimeHost,
  ) {}

  get placedObjectSprites(): Phaser.GameObjects.Sprite[] {
    return this.objectSprites;
  }

  get currentSpawnMarkerSprite(): Phaser.GameObjects.Sprite | null {
    return this.spawnMarkerSprite;
  }

  get currentGoalMarkerSprites(): Phaser.GameObjects.Sprite[] {
    return this.goalMarkerSprites;
  }

  get currentGoalMarkerLabels(): Phaser.GameObjects.Text[] {
    return this.goalMarkerLabels;
  }

  get currentRoomGoal(): RoomGoal | null {
    return this.roomGoal;
  }

  get currentRoomSpawnPoint(): RoomSpawnPoint | null {
    return this.roomSpawnPoint;
  }

  get isRoomDirty(): boolean {
    return this.roomDirty;
  }

  set isRoomDirty(value: boolean) {
    this.roomDirty = value;
  }

  get currentLastDirtyAt(): number {
    return this.lastDirtyAt;
  }

  set currentLastDirtyAt(value: number) {
    this.lastDirtyAt = value;
  }

  get currentGoalPlacementMode(): GoalPlacementMode {
    return this.goalPlacementMode;
  }

  set currentGoalPlacementMode(value: GoalPlacementMode) {
    this.goalPlacementMode = value;
  }

  get currentClipboardState(): EditorClipboardState | null {
    return this.clipboardState
      ? {
          sourceLayer: this.clipboardState.sourceLayer,
          width: this.clipboardState.width,
          height: this.clipboardState.height,
          tiles: this.clipboardState.tiles.map((row) => [...row]),
          occupiedMask: this.clipboardState.occupiedMask.map((row) => [...row]),
        }
      : null;
  }

  initializeGraphics(): void {
    // Goal markers are sprite-backed; no persistent graphics overlay needed.
  }

  private canEditRoom(): boolean {
    return this.host.canSaveDraft();
  }

  private guardEditable(): boolean {
    if (this.canEditRoom()) {
      return true;
    }

    this.host.updatePersistenceStatus('Minted room is read-only for non-owners.');
    return false;
  }

  reset(): void {
    for (const sprite of this.objectSprites) {
      sprite.destroy();
    }
    this.objectSprites = [];

    for (const sprite of this.goalMarkerSprites) {
      sprite.destroy();
    }
    this.goalMarkerSprites = [];

    for (const label of this.goalMarkerLabels) {
      label.destroy();
    }
    this.goalMarkerLabels = [];

    this.spawnMarkerSprite?.destroy();
    this.spawnMarkerSprite = null;

    this.roomGoal = null;
    this.roomSpawnPoint = null;
    this.roomDirty = false;
    this.lastDirtyAt = 0;
    this.goalPlacementMode = null;
    this.undoStack = [];
    this.redoStack = [];
    this.currentBatch = [];
    this.clipboardState = null;
  }

  applyRoomSnapshot(room: RoomSnapshot): void {
    const tileData = room.tileData;

    for (const layerName of LAYER_NAMES) {
      const layer = this.host.getLayers().get(layerName);
      if (!layer) {
        continue;
      }

      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          const encodedTileValue = tileData[layerName][y][x];
          const { gid, flipX, flipY } = decodeTileDataValue(encodedTileValue);
          if (gid > 0) {
            const tile = layer.putTileAt(gid, x, y);
            if (tile) {
              tile.flipX = flipX;
              tile.flipY = flipY;
            }
          } else {
            layer.removeTileAt(x, y);
          }
        }
      }
    }

    editorState.selectedBackground = room.background;
    this.host.updateBackgroundSelectValue(room.background);
    this.host.updateBackground();

    this.roomGoal = cloneRoomGoal(room.goal);
    this.roomSpawnPoint = room.spawnPoint ? { ...room.spawnPoint } : null;
    editorState.placedObjects = room.placedObjects.map((placed) => ({ ...placed }));
    this.rebuildObjectSprites();
    this.host.updateGoalUi();

    this.undoStack = [];
    this.redoStack = [];
    this.currentBatch = [];
    this.roomDirty = false;
    this.lastDirtyAt = 0;
  }

  hasClipboardTiles(): boolean {
    return Boolean(this.clipboardState);
  }

  copyTilesToClipboard(x1: number, y1: number, x2: number, y2: number): boolean {
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return false;
    }

    const minX = Math.max(0, Math.min(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxX = Math.min(ROOM_WIDTH - 1, Math.max(x1, x2));
    const maxY = Math.min(ROOM_HEIGHT - 1, Math.max(y1, y2));
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width <= 0 || height <= 0) {
      return false;
    }

    const tiles: number[][] = [];
    const occupiedMask: boolean[][] = [];
    let hasOccupiedTiles = false;

    for (let dy = 0; dy < height; dy += 1) {
      const tileRow: number[] = [];
      const occupiedRow: boolean[] = [];
      for (let dx = 0; dx < width; dx += 1) {
        const existingTile = layer.getTileAt(minX + dx, minY + dy);
        const encodedTileValue = existingTile
          ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
          : -1;
        const occupied = encodedTileValue >= 0;
        tileRow.push(encodedTileValue);
        occupiedRow.push(occupied);
        hasOccupiedTiles ||= occupied;
      }
      tiles.push(tileRow);
      occupiedMask.push(occupiedRow);
    }

    if (!hasOccupiedTiles) {
      return false;
    }

    this.clipboardState = {
      sourceLayer: editorState.activeLayer,
      width,
      height,
      tiles,
      occupiedMask,
    };
    return true;
  }

  pasteClipboardAt(baseTileX: number, baseTileY: number): boolean {
    if (!this.guardEditable()) {
      return false;
    }

    const layer = this.host.getLayers().get(editorState.activeLayer);
    const clipboard = this.clipboardState;
    if (!layer || !clipboard) {
      return false;
    }

    let changed = false;
    for (let dy = 0; dy < clipboard.height; dy += 1) {
      for (let dx = 0; dx < clipboard.width; dx += 1) {
        if (!clipboard.occupiedMask[dy]?.[dx]) {
          continue;
        }

        const tileX = baseTileX + dx;
        const tileY = baseTileY + dy;
        if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
          continue;
        }

        const newGid = clipboard.tiles[dy]?.[dx] ?? -1;
        if (newGid < 0) {
          continue;
        }

        const existingTile = layer.getTileAt(tileX, tileY);
        const oldGid = existingTile
          ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
          : -1;
        if (oldGid === newGid) {
          continue;
        }

        const decoded = decodeTileDataValue(newGid);
        const pastedTile = layer.putTileAt(decoded.gid, tileX, tileY);
        if (pastedTile) {
          pastedTile.flipX = decoded.flipX;
          pastedTile.flipY = decoded.flipY;
        }

        this.currentBatch.push({
          layer: editorState.activeLayer,
          x: tileX,
          y: tileY,
          oldGid,
          newGid,
        });
        changed = true;
      }
    }

    return changed;
  }

  exportRoomSnapshot(): RoomSnapshot {
    const metadata = this.host.getRoomSnapshotMetadata();

    return {
      id: metadata.roomId,
      coordinates: { ...metadata.coordinates },
      title: metadata.title,
      background: editorState.selectedBackground,
      goal: cloneRoomGoal(this.roomGoal),
      spawnPoint: this.roomSpawnPoint ? { ...this.roomSpawnPoint } : null,
      tileData: this.serializeTileData(),
      placedObjects: editorState.placedObjects.map((placed) => ({ ...placed })),
      version: metadata.version,
      status: 'draft',
      createdAt: metadata.createdAt || new Date().toISOString(),
      updatedAt: metadata.updatedAt || new Date().toISOString(),
      publishedAt: metadata.publishedAt,
    };
  }

  beginTileBatch(): void {
    if (!this.guardEditable()) {
      this.currentBatch = [];
      return;
    }
    this.currentBatch = [];
  }

  commitTileBatch(): void {
    if (this.currentBatch.length === 0) {
      return;
    }

    this.undoStack.push({ kind: 'tiles', actions: [...this.currentBatch] });
    this.redoStack = [];
    this.currentBatch = [];
    this.markRoomDirty();
  }

  clearTileBatch(): void {
    this.currentBatch = [];
  }

  private clonePlacedObjects(placedObjects: PlacedObject[] = editorState.placedObjects): PlacedObject[] {
    return placedObjects.map((placed) => ({ ...placed }));
  }

  placeTileAt(worldX: number, worldY: number): void {
    if (!this.guardEditable()) {
      return;
    }
    const baseTileX = Math.floor(worldX / TILE_SIZE);
    const baseTileY = Math.floor(worldY / TILE_SIZE);
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }

    const selection = editorState.selection;
    for (let dy = 0; dy < selection.height; dy += 1) {
      for (let dx = 0; dx < selection.width; dx += 1) {
        const tileX = baseTileX + dx;
        const tileY = baseTileY + dy;
        if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
          continue;
        }

        const newGid = getSelectionTileValue(dx, dy);
        if (newGid < 0) {
          continue;
        }

        const existingTile = layer.getTileAt(tileX, tileY);
        const oldGid = existingTile
          ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
          : -1;
        if (oldGid === newGid) {
          continue;
        }

        const placedTile = layer.putTileAt(decodeTileDataValue(newGid).gid, tileX, tileY);
        if (placedTile) {
          const decoded = decodeTileDataValue(newGid);
          placedTile.flipX = decoded.flipX;
          placedTile.flipY = decoded.flipY;
        }
        this.currentBatch.push({
          layer: editorState.activeLayer,
          x: tileX,
          y: tileY,
          oldGid,
          newGid,
        });
      }
    }
  }

  eraseTileAt(worldX: number, worldY: number): void {
    if (!this.guardEditable()) {
      return;
    }

    const brushSize = Math.max(1, editorState.eraserBrushSize);
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }

    const radius = Math.floor(brushSize * 0.5);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const targetX = tileX + dx;
        const targetY = tileY + dy;
        if (targetX < 0 || targetX >= ROOM_WIDTH || targetY < 0 || targetY >= ROOM_HEIGHT) {
          continue;
        }

        const existingTile = layer.getTileAt(targetX, targetY);
        if (!existingTile) {
          continue;
        }

        const oldGid = encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY);
        layer.removeTileAt(targetX, targetY);
        this.currentBatch.push({
          layer: editorState.activeLayer,
          x: targetX,
          y: targetY,
          oldGid,
          newGid: -1,
        });
      }
    }
  }

  clearCurrentLayer(): void {
    if (!this.guardEditable()) {
      return;
    }

    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }

    const actions: TileAction[] = [];
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

    if (actions.length === 0) {
      return;
    }

    this.undoStack.push({ kind: 'tiles', actions });
    this.redoStack = [];
    this.markRoomDirty();
  }

  clearAllTiles(): void {
    if (!this.guardEditable()) {
      return;
    }

    const actions: TileAction[] = [];
    for (const layerName of LAYER_NAMES) {
      const layer = this.host.getLayers().get(layerName);
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

    if (actions.length === 0) {
      return;
    }

    this.undoStack.push({ kind: 'tiles', actions });
    this.redoStack = [];
    this.markRoomDirty();
  }

  fillRect(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.guardEditable()) {
      return;
    }
    const minX = Math.max(0, Math.min(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxX = Math.min(ROOM_WIDTH - 1, Math.max(x1, x2));
    const maxY = Math.min(ROOM_HEIGHT - 1, Math.max(y1, y2));
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer || editorState.selectedTileGid < 0) {
      return;
    }

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const existingTile = layer.getTileAt(x, y);
        const oldGid = existingTile
          ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
          : -1;
        const newGid = getSelectionTileValue(0, 0);

        if (oldGid !== newGid) {
          const decoded = decodeTileDataValue(newGid);
          const placedTile = layer.putTileAt(decoded.gid, x, y);
          if (placedTile) {
            placedTile.flipX = decoded.flipX;
            placedTile.flipY = decoded.flipY;
          }
          this.currentBatch.push({
            layer: editorState.activeLayer,
            x,
            y,
            oldGid,
            newGid,
          });
        }
      }
    }
  }

  floodFill(startX: number, startY: number): void {
    if (!this.guardEditable()) {
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer || editorState.selectedTileGid < 0) {
      return;
    }

    const targetTile = layer.getTileAt(startX, startY);
    const targetGid = targetTile
      ? encodeTileDataValue(targetTile.index, targetTile.flipX, targetTile.flipY)
      : -1;
    const fillGid = getSelectionTileValue(0, 0);
    if (targetGid === fillGid) {
      return;
    }

    const visited = new Set<string>();
    const queue: [number, number][] = [[startX, startY]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) {
        continue;
      }
      if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) {
        continue;
      }

      const tile = layer.getTileAt(x, y);
      const currentGid = tile
        ? encodeTileDataValue(tile.index, tile.flipX, tile.flipY)
        : -1;
      if (currentGid !== targetGid) {
        continue;
      }

      visited.add(key);
      const decoded = decodeTileDataValue(fillGid);
      const placedTile = layer.putTileAt(decoded.gid, x, y);
      if (placedTile) {
        placedTile.flipX = decoded.flipX;
        placedTile.flipY = decoded.flipY;
      }
      this.currentBatch.push({
        layer: editorState.activeLayer,
        x,
        y,
        oldGid: targetGid,
        newGid: fillGid,
      });

      queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
  }

  handleObjectPlace(worldX: number, worldY: number, tileX: number, tileY: number): PlacedObject | null {
    if (!this.guardEditable()) {
      return null;
    }
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return null;
    }

    if (editorState.activeTool === 'eraser') {
      this.removeObjectAt(worldX, worldY);
      return null;
    }

    if (!editorState.selectedObjectId) {
      return null;
    }

    const objectConfig = getObjectById(editorState.selectedObjectId);
    if (!objectConfig) {
      return null;
    }

    if (objectConfig.id === 'spawn_point') {
      this.placeSpawnPoint(tileX, tileY);
      return null;
    }

    const placed: PlacedObject = {
      id: editorState.selectedObjectId,
      x: tileX * TILE_SIZE + objectConfig.frameWidth / 2,
      y: tileY * TILE_SIZE + TILE_SIZE - objectConfig.frameHeight / 2,
      instanceId: createPlacedObjectInstanceId(),
      facing: objectConfig.facingDirection ? editorState.objectFacing : undefined,
      layer: editorState.activeLayer,
      triggerTargetInstanceId: null,
      containedObjectId: null,
    };

    const previous = this.clonePlacedObjects();
    const next = [...previous, placed];
    editorState.placedObjects = next;
    this.undoStack.push({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.redoStack = [];
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return placed;
  }

  removeObjectAt(worldX: number, worldY: number): PlacedObject | null {
    if (!this.guardEditable()) {
      return null;
    }
    if (this.roomSpawnPoint) {
      const spawnDist = Math.hypot(this.roomSpawnPoint.x - worldX, this.roomSpawnPoint.y - worldY);
      if (spawnDist < 14) {
        this.updateSpawnPoint(null);
        return null;
      }
    }

    if (this.removeGoalMarkerAt(worldX, worldY)) {
      return null;
    }

    const target = this.findPlacedObjectAt(worldX, worldY);
    if (!target) {
      return null;
    }

    let bestIndex = -1;
    for (let i = editorState.placedObjects.length - 1; i >= 0; i -= 1) {
      const placed = editorState.placedObjects[i];
      if (
        placed === target ||
        (Boolean(target.instanceId) && placed.instanceId === target.instanceId)
      ) {
        bestIndex = i;
        break;
      }
    }

    if (bestIndex < 0) {
      return null;
    }

    const previous = this.clonePlacedObjects();
    const removed = previous[bestIndex];
    const next = previous
      .filter((_, index) => index !== bestIndex)
      .map((placed) =>
        placed.triggerTargetInstanceId === removed.instanceId
          ? { ...placed, triggerTargetInstanceId: null }
          : placed
      );
    editorState.placedObjects = next;
    this.undoStack.push({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.redoStack = [];
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return removed;
  }

  canRemoveObjectAt(worldX: number, worldY: number): boolean {
    if (this.roomSpawnPoint) {
      const spawnDist = Math.hypot(this.roomSpawnPoint.x - worldX, this.roomSpawnPoint.y - worldY);
      if (spawnDist < 14) {
        return true;
      }
    }

    return Boolean(this.findPlacedObjectAt(worldX, worldY));
  }

  rebuildObjectSprites(): void {
    for (const sprite of this.objectSprites) {
      sprite.destroy();
    }
    this.objectSprites = [];

    for (const placed of editorState.placedObjects) {
      const objectConfig = getObjectById(placed.id);
      if (!objectConfig) {
        continue;
      }

      const sprite = this.scene.add.sprite(placed.x, placed.y, objectConfig.id, 0);
      sprite.setDepth(this.getPlacedObjectEditorDepth(placed));
      sprite.setOrigin(0.5, 0.5);
      if (objectConfig.frameCount > 1 && objectConfig.fps > 0) {
        const animKey = `${objectConfig.id}_anim`;
        if (this.scene.anims.exists(animKey)) {
          sprite.play(animKey);
        }
      } else {
        sprite.setFrame(getObjectDefaultFrame(objectConfig));
      }
      if (placed.id === 'door_metal') {
        sprite.setTint(0xb8c4d8);
      }
      this.applyPlacedObjectFacing(sprite, objectConfig, placed);
      this.objectSprites.push(sprite);
    }

    this.spawnMarkerSprite?.destroy();
    this.spawnMarkerSprite = null;
    if (this.roomSpawnPoint) {
      this.spawnMarkerSprite = this.scene.add.sprite(
        this.roomSpawnPoint.x,
        this.roomSpawnPoint.y,
        'spawn_point',
        0,
      );
      this.spawnMarkerSprite.setOrigin(0.5, 1);
      this.spawnMarkerSprite.setDepth(26);
      this.spawnMarkerSprite.setAlpha(0.92);
    }

    this.redrawGoalMarkers();
    this.host.updateGoalUi();
    this.host.syncBackgroundCameraIgnores();
  }

  getPlacedObjectByInstanceId(instanceId: string | null | undefined): PlacedObject | null {
    if (!instanceId) {
      return null;
    }

    return editorState.placedObjects.find((placed) => placed.instanceId === instanceId) ?? null;
  }

  hasPlacedObjectInstanceId(instanceId: string | null | undefined): boolean {
    return Boolean(this.getPlacedObjectByInstanceId(instanceId));
  }

  findPlacedObjectAt(
    worldX: number,
    worldY: number,
    filter?: (placed: PlacedObject) => boolean,
  ): PlacedObject | null {
    let bestMatch: PlacedObject | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = editorState.placedObjects.length - 1; index >= 0; index -= 1) {
      const placed = editorState.placedObjects[index];
      if (filter && !filter(placed)) {
        continue;
      }

      const bounds = this.getPlacedObjectBounds(placed);
      const contains = Phaser.Geom.Rectangle.Contains(bounds, worldX, worldY);
      const distance = Math.hypot(placed.x - worldX, placed.y - worldY);
      if (!contains && distance > 18) {
        continue;
      }

      const score = contains ? distance : distance + 20;
      if (score < bestScore) {
        bestScore = score;
        bestMatch = placed;
      }
    }

    return bestMatch;
  }

  getPressurePlateEligibleTargets(triggerInstanceId: string | null | undefined): PlacedObject[] {
    return editorState.placedObjects.filter((placed) => {
      if (!canPlacedObjectBePressurePlateTarget(placed)) {
        return false;
      }

      return placed.instanceId !== triggerInstanceId;
    });
  }

  setContainerContents(
    containerInstanceId: string,
    containedObjectId: string | null,
  ): boolean {
    const containerIndex = editorState.placedObjects.findIndex(
      (placed) => placed.instanceId === containerInstanceId
    );
    if (containerIndex < 0) {
      return false;
    }

    const container = editorState.placedObjects[containerIndex];
    if (!canPlacedObjectBeContainer(container)) {
      return false;
    }

    if (containedObjectId) {
      const objectConfig = getObjectById(containedObjectId);
      if (!canObjectBeStoredInContainer(container.id, objectConfig)) {
        return false;
      }
    }

    const previous = this.clonePlacedObjects();
    const previousContents = previous[containerIndex]?.containedObjectId ?? null;
    if (previousContents === containedObjectId) {
      return true;
    }

    const next = previous.map((placed, index) =>
      index === containerIndex
        ? {
            ...placed,
            containedObjectId,
          }
        : placed
    );
    editorState.placedObjects = next;
    this.undoStack.push({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.redoStack = [];
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  setPressurePlateTarget(
    triggerInstanceId: string,
    targetInstanceId: string | null,
  ): boolean {
    const triggerIndex = editorState.placedObjects.findIndex(
      (placed) => placed.instanceId === triggerInstanceId
    );
    if (triggerIndex < 0) {
      return false;
    }

    const trigger = editorState.placedObjects[triggerIndex];
    if (!canPlacedObjectTriggerOtherObjects(trigger)) {
      return false;
    }

    if (targetInstanceId) {
      const target = this.getPlacedObjectByInstanceId(targetInstanceId);
      if (
        !target ||
        target.instanceId === triggerInstanceId ||
        !canPlacedObjectBePressurePlateTarget(target)
      ) {
        return false;
      }
    }

    const previous = this.clonePlacedObjects();
    const next = previous.map((placed, index) =>
      index === triggerIndex
        ? {
            ...placed,
            triggerTargetInstanceId: targetInstanceId,
          }
        : placed
    );
    const previousTarget = previous[triggerIndex]?.triggerTargetInstanceId ?? null;
    if (previousTarget === targetInstanceId) {
      return true;
    }

    editorState.placedObjects = next;
    this.undoStack.push({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.redoStack = [];
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  getPlacedObjectBounds(placed: PlacedObject): Phaser.Geom.Rectangle {
    const objectConfig = getObjectById(placed.id);
    if (!objectConfig) {
      return new Phaser.Geom.Rectangle(placed.x - 8, placed.y - 8, 16, 16);
    }

    const width = Math.max(
      objectConfig.previewWidth ?? 0,
      objectConfig.bodyWidth ?? 0,
      objectConfig.frameWidth
    );
    const height = Math.max(
      objectConfig.previewHeight ?? 0,
      objectConfig.bodyHeight ?? 0,
      objectConfig.frameHeight
    );
    const x =
      placed.x -
      objectConfig.frameWidth * 0.5 +
      (objectConfig.previewOffsetX ?? 0);
    const y =
      placed.y -
      objectConfig.frameHeight * 0.5 +
      (objectConfig.previewOffsetY ?? 0);

    return new Phaser.Geom.Rectangle(x - 4, y - 4, width + 8, height + 8);
  }

  getContainerContentsLabel(placed: PlacedObject | null | undefined): string | null {
    if (!placed || !canPlacedObjectBeContainer(placed) || !placed.containedObjectId) {
      return null;
    }

    return getObjectById(placed.containedObjectId)?.name ?? null;
  }

  private applyPlacedObjectFacing(
    sprite: Phaser.GameObjects.Sprite,
    objectConfig: ReturnType<typeof getObjectById>,
    placed: PlacedObject
  ): void {
    if (!objectConfig?.facingDirection || !placed.facing) {
      sprite.setFlipX(false);
      return;
    }

    sprite.setFlipX(objectConfig.facingDirection !== placed.facing);
  }

  private getPlacedObjectEditorDepth(placed: PlacedObject): number {
    switch (getPlacedObjectLayer(placed)) {
      case 'background':
        return 5;
      case 'foreground':
        return 60;
      case 'terrain':
      default:
        return 25;
    }
  }

  setGoalType(nextType: RoomGoalType | null): void {
    if (!this.guardEditable()) {
      return;
    }
    this.goalPlacementMode = null;
    this.updateRoomGoal(nextType ? createDefaultRoomGoal(nextType) : null);
  }

  setGoalTimeLimitSeconds(seconds: number | null): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.roomGoal || !goalSupportsTimeLimit(this.roomGoal.type)) {
      return;
    }

    const nextGoal = cloneRoomGoal(this.roomGoal);
    if (!nextGoal || !goalSupportsTimeLimit(nextGoal.type) || nextGoal.type === 'survival') {
      return;
    }

    nextGoal.timeLimitMs = seconds && seconds > 0 ? Math.round(seconds * 1000) : null;
    this.updateRoomGoal(nextGoal);
  }

  setGoalRequiredCount(requiredCount: number): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.roomGoal || this.roomGoal.type !== 'collect_target') {
      return;
    }

    const nextGoal = cloneRoomGoal(this.roomGoal);
    if (!nextGoal || nextGoal.type !== 'collect_target') {
      return;
    }

    nextGoal.requiredCount = Math.max(1, Math.round(requiredCount));
    this.updateRoomGoal(nextGoal);
  }

  setGoalSurvivalSeconds(seconds: number): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.roomGoal || this.roomGoal.type !== 'survival') {
      return;
    }

    const nextGoal = cloneRoomGoal(this.roomGoal);
    if (!nextGoal || nextGoal.type !== 'survival') {
      return;
    }

    nextGoal.durationMs = Math.max(1, Math.round(seconds)) * 1000;
    this.updateRoomGoal(nextGoal);
  }

  startGoalMarkerPlacement(mode: GoalPlacementMode): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.goalUsesMarkers(this.roomGoal)) {
      this.goalPlacementMode = null;
      this.host.updateGoalUi();
      return;
    }

    this.goalPlacementMode = this.goalPlacementMode === mode ? null : mode;
    this.host.updateGoalUi();
  }

  clearGoalMarkers(): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.goalUsesMarkers(this.roomGoal)) {
      return;
    }

    const nextGoal = cloneRoomGoal(this.roomGoal);
    if (!nextGoal) {
      return;
    }

    if (nextGoal.type === 'reach_exit') {
      nextGoal.exit = null;
    } else if (nextGoal.type === 'checkpoint_sprint') {
      nextGoal.checkpoints = [];
      nextGoal.finish = null;
    }

    this.goalPlacementMode = null;
    this.updateRoomGoal(nextGoal);
  }

  getGoalEditorState(): {
    goal: RoomGoal | null;
    placementMode: GoalPlacementMode;
    availableCollectibles: number;
    availableEnemies: number;
  } {
    return {
      goal: cloneRoomGoal(this.roomGoal),
      placementMode: this.goalPlacementMode,
      availableCollectibles: this.countPlacedObjectsByCategory('collectible'),
      availableEnemies: this.countPlacedObjectsByCategory('enemy'),
    };
  }

  placeGoalMarker(tileX: number, tileY: number): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.roomGoal || !this.goalPlacementMode) {
      return;
    }

    const point = createGoalMarkerPointFromTile(tileX, tileY);
    const nextGoal = cloneRoomGoal(this.roomGoal);
    if (!nextGoal) {
      return;
    }

    if (nextGoal.type === 'reach_exit' && this.goalPlacementMode === 'exit') {
      nextGoal.exit = point;
      this.goalPlacementMode = null;
      this.updateRoomGoal(nextGoal);
      return;
    }

    if (nextGoal.type !== 'checkpoint_sprint') {
      return;
    }

    if (this.goalPlacementMode === 'checkpoint') {
      nextGoal.checkpoints = [...nextGoal.checkpoints, point];
      this.updateRoomGoal(nextGoal);
      return;
    }

    if (this.goalPlacementMode === 'finish') {
      nextGoal.finish = point;
      this.goalPlacementMode = null;
      this.updateRoomGoal(nextGoal);
    }
  }

  removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    if (!this.guardEditable()) {
      return false;
    }
    if (!this.roomGoal) {
      return false;
    }

    if (this.roomGoal.type === 'reach_exit' && this.roomGoal.exit) {
      const distance = Math.hypot(this.roomGoal.exit.x - worldX, this.roomGoal.exit.y - worldY);
      if (distance < 16) {
        const nextGoal = cloneRoomGoal(this.roomGoal);
        if (nextGoal && nextGoal.type === 'reach_exit') {
          nextGoal.exit = null;
          this.updateRoomGoal(nextGoal);
          return true;
        }
      }
    }

    if (this.roomGoal.type !== 'checkpoint_sprint') {
      return false;
    }

    const goal = this.roomGoal as CheckpointSprintGoal;
    if (goal.finish) {
      const finishDistance = Math.hypot(goal.finish.x - worldX, goal.finish.y - worldY);
      if (finishDistance < 16) {
        const nextGoal = cloneRoomGoal(goal);
        if (nextGoal && nextGoal.type === 'checkpoint_sprint') {
          nextGoal.finish = null;
          this.updateRoomGoal(nextGoal);
          return true;
        }
      }
    }

    let bestIndex = -1;
    let bestDistance = 16;
    for (let index = 0; index < goal.checkpoints.length; index += 1) {
      const checkpoint = goal.checkpoints[index];
      const distance = Math.hypot(checkpoint.x - worldX, checkpoint.y - worldY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      const nextGoal = cloneRoomGoal(goal);
      if (nextGoal && nextGoal.type === 'checkpoint_sprint') {
        nextGoal.checkpoints.splice(bestIndex, 1);
        this.updateRoomGoal(nextGoal);
        return true;
      }
    }

    return false;
  }

  goalUsesMarkers(goal: RoomGoal | null): boolean {
    return goal?.type === 'reach_exit' || goal?.type === 'checkpoint_sprint';
  }

  getGoalSummaryText(): string {
    if (!this.roomGoal) {
      return 'No room goal selected.';
    }

    switch (this.roomGoal.type) {
      case 'reach_exit':
        return this.roomGoal.exit
          ? 'Reach the exit marker to clear the room.'
          : 'Set an exit marker to finish the room.';
      case 'collect_target': {
        const available = this.countPlacedObjectsByCategory('collectible');
        return `Collect ${this.roomGoal.requiredCount} item${this.roomGoal.requiredCount === 1 ? '' : 's'} (${available} placed).`;
      }
      case 'defeat_all': {
        const available = this.countPlacedObjectsByCategory('enemy');
        return `Defeat every enemy in the room (${available} placed).`;
      }
      case 'checkpoint_sprint':
        return `Hit ${this.roomGoal.checkpoints.length} checkpoint${this.roomGoal.checkpoints.length === 1 ? '' : 's'} then reach the finish marker.`;
      case 'survival':
        return `Stay alive for ${Math.round(this.roomGoal.durationMs / 1000)} seconds.`;
    }
  }

  hasUndoHistory(): boolean {
    return this.undoStack.length > 0;
  }

  hasRedoHistory(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    if (!this.guardEditable()) {
      return;
    }
    const action = this.undoStack.pop();
    if (!action) {
      return;
    }

    if (action.kind === 'tiles') {
      const reverseActions: TileAction[] = [];
      for (const a of action.actions) {
        const layer = this.host.getLayers().get(a.layer);
        if (!layer) {
          continue;
        }

        if (a.oldGid === -1) {
          layer.removeTileAt(a.x, a.y);
        } else {
          const decoded = decodeTileDataValue(a.oldGid);
          const restoredTile = layer.putTileAt(decoded.gid, a.x, a.y);
          if (restoredTile) {
            restoredTile.flipX = decoded.flipX;
            restoredTile.flipY = decoded.flipY;
          }
        }

        reverseActions.push({
          ...a,
          oldGid: a.newGid,
          newGid: a.oldGid,
        });
      }
      this.redoStack.push({ kind: 'tiles', actions: reverseActions });
      this.markRoomDirty();
      return;
    }

    if (action.kind === 'objects') {
      editorState.placedObjects = this.clonePlacedObjects(action.action.previous);
      this.redoStack.push({
        kind: 'objects',
        action: {
          previous: this.clonePlacedObjects(action.action.next),
          next: this.clonePlacedObjects(action.action.previous),
        },
      });
      this.rebuildObjectSprites();
      this.markRoomDirty();
      return;
    }

    if (action.kind === 'spawn') {
      this.roomSpawnPoint = action.action.previous ? { ...action.action.previous } : null;
      this.redoStack.push({
        kind: 'spawn',
        action: {
          previous: action.action.next ? { ...action.action.next } : null,
          next: action.action.previous ? { ...action.action.previous } : null,
        },
      });
      this.rebuildObjectSprites();
      this.markRoomDirty();
      return;
    }

    this.roomGoal = cloneRoomGoal(action.action.previous);
    this.goalPlacementMode = null;
    this.redoStack.push({
      kind: 'goal',
      action: {
        previous: cloneRoomGoal(action.action.next),
        next: cloneRoomGoal(action.action.previous),
      },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  redo(): void {
    if (!this.guardEditable()) {
      return;
    }
    const action = this.redoStack.pop();
    if (!action) {
      return;
    }

    if (action.kind === 'tiles') {
      const reverseActions: TileAction[] = [];
      for (const a of action.actions) {
        const layer = this.host.getLayers().get(a.layer);
        if (!layer) {
          continue;
        }

        if (a.newGid === -1) {
          layer.removeTileAt(a.x, a.y);
        } else {
          const decoded = decodeTileDataValue(a.newGid);
          const restoredTile = layer.putTileAt(decoded.gid, a.x, a.y);
          if (restoredTile) {
            restoredTile.flipX = decoded.flipX;
            restoredTile.flipY = decoded.flipY;
          }
        }

        reverseActions.push({
          ...a,
          oldGid: a.newGid,
          newGid: a.oldGid,
        });
      }
      this.undoStack.push({ kind: 'tiles', actions: reverseActions });
      this.markRoomDirty();
      return;
    }

    if (action.kind === 'objects') {
      editorState.placedObjects = this.clonePlacedObjects(action.action.previous);
      this.undoStack.push({
        kind: 'objects',
        action: {
          previous: this.clonePlacedObjects(action.action.next),
          next: this.clonePlacedObjects(action.action.previous),
        },
      });
      this.rebuildObjectSprites();
      this.markRoomDirty();
      return;
    }

    if (action.kind === 'spawn') {
      this.roomSpawnPoint = action.action.previous ? { ...action.action.previous } : null;
      this.undoStack.push({
        kind: 'spawn',
        action: {
          previous: action.action.next ? { ...action.action.next } : null,
          next: action.action.previous ? { ...action.action.previous } : null,
        },
      });
      this.rebuildObjectSprites();
      this.markRoomDirty();
      return;
    }

    this.roomGoal = cloneRoomGoal(action.action.previous);
    this.goalPlacementMode = null;
    this.undoStack.push({
      kind: 'goal',
      action: {
        previous: cloneRoomGoal(action.action.next),
        next: cloneRoomGoal(action.action.previous),
      },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  private serializeTileData(): RoomTileData {
    const tileData = {} as RoomTileData;

    for (const layerName of LAYER_NAMES) {
      const layer = this.host.getLayers().get(layerName);
      const data: (number | -1)[][] = [];
      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        const row: (number | -1)[] = [];
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          const tile = layer?.getTileAt(x, y);
          row.push(tile ? encodeTileDataValue(tile.index, tile.flipX, tile.flipY) : -1);
        }
        data.push(row);
      }
      tileData[layerName] = data;
    }

    return tileData;
  }

  private markRoomDirty(): void {
    this.roomDirty = true;
    this.lastDirtyAt = performance.now();
    this.host.updatePersistenceStatus(
      this.host.canSaveDraft()
        ? 'Draft changes...'
        : 'Read-only minted room. Changes are local only.',
    );
  }

  private placeSpawnPoint(tileX: number, tileY: number): void {
    this.updateSpawnPoint({
      x: tileX * TILE_SIZE + TILE_SIZE / 2,
      y: tileY * TILE_SIZE + TILE_SIZE,
    });
  }

  private updateSpawnPoint(nextSpawnPoint: RoomSpawnPoint | null): void {
    const previous = this.roomSpawnPoint ? { ...this.roomSpawnPoint } : null;
    const next = nextSpawnPoint ? { ...nextSpawnPoint } : null;
    if (previous?.x === next?.x && previous?.y === next?.y) {
      return;
    }

    this.roomSpawnPoint = next;
    this.undoStack.push({
      kind: 'spawn',
      action: { previous, next },
    });
    this.redoStack = [];
    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  private redrawGoalMarkers(): void {
    for (const sprite of this.goalMarkerSprites) {
      sprite.destroy();
    }
    this.goalMarkerSprites = [];
    for (const label of this.goalMarkerLabels) {
      label.destroy();
    }
    this.goalMarkerLabels = [];

    if (!this.roomGoal) {
      this.host.syncBackgroundCameraIgnores();
      return;
    }

    const markers = this.getGoalMarkerDescriptors(this.roomGoal);
    for (const marker of markers) {
      const sprite = createGoalMarkerFlagSprite(
        this.scene,
        marker.variant,
        marker.point.x,
        marker.point.y + 2,
        97,
      );
      this.goalMarkerSprites.push(sprite);

      if (marker.label) {
        const label = this.scene.add.text(marker.point.x, marker.point.y - 28, marker.label, {
          fontFamily: 'Courier New',
          fontSize: '12px',
          color: marker.textColor,
          stroke: '#050505',
          strokeThickness: 4,
        });
        label.setOrigin(0.5, 1);
        label.setDepth(98);
        this.goalMarkerLabels.push(label);
      }
    }

    this.host.syncBackgroundCameraIgnores();
  }

  private getGoalMarkerDescriptors(goal: RoomGoal): Array<{
    point: GoalMarkerPoint;
    label: string | null;
    variant: GoalMarkerFlagVariant;
    textColor: string;
  }> {
    switch (goal.type) {
      case 'reach_exit':
        return goal.exit
          ? [{
              point: goal.exit,
              label: null,
              variant: 'finish-pending' as GoalMarkerFlagVariant,
              textColor: '#ffefef',
            }]
          : [];
      case 'checkpoint_sprint':
        return [
          ...goal.checkpoints.map((checkpoint, index) => ({
            point: checkpoint,
            label: `${index + 1}`,
            variant: 'checkpoint-pending' as GoalMarkerFlagVariant,
            textColor: '#ffefef',
          })),
          ...(goal.finish
            ? [{
                point: goal.finish,
                label: null,
                variant: 'finish-pending' as GoalMarkerFlagVariant,
                textColor: '#ffefef',
              }]
            : []),
        ];
      default:
        return [];
    }
  }

  private updateRoomGoal(nextGoal: RoomGoal | null, trackUndo: boolean = true): void {
    const previous = cloneRoomGoal(this.roomGoal);
    const normalizedNext = cloneRoomGoal(nextGoal);

    if (JSON.stringify(previous) === JSON.stringify(normalizedNext)) {
      this.host.updateGoalUi();
      return;
    }

    this.roomGoal = normalizedNext;
    if (!this.goalUsesMarkers(this.roomGoal)) {
      this.goalPlacementMode = null;
    }

    if (trackUndo) {
      this.undoStack.push({
        kind: 'goal',
        action: { previous, next: normalizedNext },
      });
      this.redoStack = [];
    }

    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  private countPlacedObjectsByCategory(category: 'collectible' | 'enemy'): number {
    let count = 0;
    for (const placed of editorState.placedObjects) {
      if (placedObjectContributesToCategory(placed, category)) {
        count += 1;
      }
    }
    return count;
  }
}
