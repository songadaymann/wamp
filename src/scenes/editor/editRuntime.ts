import { recordReplayEditorAction } from '../../analytics/replay/editorEvents';
import Phaser from 'phaser';
import {
  getSolidColorFromBackgroundValue,
  normalizeRoomBackground,
} from '../../backgrounds/model';
import {
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBeLinkedObjectTarget,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectUseObjectLink,
  createPlacedObjectInstanceId,
  decodeTileDataValue,
  encodeTileDataValue,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  getObjectById,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getObjectPlacementPointForTile,
  placedObjectContributesToCategory,
  getSelectionTileValue,
  type LayerName,
  type PlacedObject,
} from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { SWORDSMAN_AI_OBJECT_ID } from '../../enemies/swordsmanAi';
import {
  DEFAULT_POLICE_BEHAVIOR_MODE,
  DEFAULT_POLICE_PATROL_SHOOTS,
  isPoliceEnemyObjectId,
  normalizePoliceBehaviorMode,
  type PoliceBehaviorMode,
} from '../../enemies/policeEnemy';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
  normalizeSwordsmanDefeatMode,
  normalizeSwordsmanObjectiveMode,
  type SwordsmanDefeatMode,
  type SwordsmanObjectiveMode,
} from '../../enemies/swordsmanObjectives';
import {
  getCustomSpriteDefinitionByObjectId,
  getCustomSpriteDefinitionsForPlacedObjects,
} from '../../customSprites/registry';
import type { CustomSpriteDefinition } from '../../customSprites/model';
import {
  buildCustomRoomTileFromSprite,
  CUSTOM_ROOM_TILE_MAX_TILES,
  CUSTOM_ROOM_TILESET_KEY_PREFIX,
  findCustomRoomTileIndexForSourceSprite,
  getCustomRoomTileGid,
  normalizeCustomRoomTileDefinitions,
  type CustomRoomTileDefinition,
} from '../../customTiles/model';
import {
  buildCustomRoomTileTextureKey,
  ensureCustomRoomTileTexture,
  syncCustomRoomTilesetForLayers,
} from '../../customTiles/runtime';
import {
  createPlacedObjectAnchorCell,
  findConflictingPlacedObjectAtAnchorCell,
  getPlacedObjectAnchorCell,
} from '../../placedObjects/occupancy';
import {
  canPlacedObjectUseObjectPath,
  getPlacedObjectPathTargetIds,
  withPlacedObjectPathTargets,
} from '../../placedObjects/objectPaths';
import {
  cloneRoomGoal,
  createDefaultRoomGoal,
  createGoalMarkerPointFromTile,
  getRoomGoalPublishValidationError,
  goalSupportsTimeLimit,
  normalizeRoomGoalIntroText,
  type RoomGoal,
  type RoomGoalType,
} from '../../goals/roomGoals';
import {
  cloneRoomLightingSettings,
  type RoomLightingSettings,
} from '../../lighting/model';
import {
  cloneRoomWeatherSettings,
  type RoomWeatherSettings,
} from '../../weather/model';
import {
  cloneRoomMusic,
  createDefaultRoomPatternMusic,
  isRoomMusicEmpty,
  type RoomMusic,
} from '../../music/model';
import type { RoomCoordinates, RoomSnapshot, RoomSpawnPoint, RoomTileData } from '../../persistence/roomRepository';
import { canPlacedObjectHaveSignText, normalizeSignText } from '../../signs/model';
import { EDITOR_SPAWN_PLACED_EVENT } from './uiEvents';
import { canRepeatSelectedEditorObject } from './editorToolSelection';
import {
  DEFAULT_NPC_DEFEAT_MODE,
  DEFAULT_NPC_FRIENDLY_FIRE,
  DEFAULT_NPC_MODE,
  DEFAULT_NPC_PLAYER_COLLISION,
  getPlacedNpcName,
  isNpcObjectId,
  normalizeNpcCanJumpFall,
  normalizeNpcDefeatMode,
  normalizeNpcMode,
  normalizeNpcName,
  type NpcMode,
} from '../../npcs/model';
import { EditorHistory } from './history';
import { iterateShapeTiles, type EditorShapeKind, type TilePoint } from './shapeTiles';
import {
  clampRandomizeBrushSize,
  collectOccupiedSelectionValues,
  sampleDrawWindow,
  samplePatternWindow,
  scrambleWindow,
  isScrambleOneByOne,
  applyEditorTileFlipModes,
} from './randomizeTiles';
import { encodedTilesMatchForFlood } from './floodFillMatch';
import {
  diagonalPatternIndex,
  getOrderedSelectionValues,
  pathPatternIndex,
} from './selectionPattern';
import { isPencilBrushPlacement } from './editorToolSelection';
import {
  buildEditorClipboardState,
  cloneEditorClipboardState,
  planEditorClipboardPaste,
  planEditorSmartClipboardPaste,
  type EditorClipboardState,
} from './clipboard';
import {
  clonePlacedObjectDocument,
  removePlacedObjectFromDocument,
} from './placedObjectDocument';
import {
  clearRoomGoalMarkers,
  getRoomGoalSummaryText,
  placeRoomGoalMarker,
  removeRoomGoalMarkerAt,
  roomGoalUsesMarkers,
  withNpcQuestType,
  withRoomGoalRequiredCount,
  withRoomGoalSurvivalSeconds,
  withRoomGoalTimeLimitSeconds,
  type GoalPlacementMode,
} from './goalDocument';
import { EditorDocumentPresentationController } from './documentPresentationController';
import {
  cloneRoomSmartTerrainState,
  createRoomSmartTerrainState,
  normalizeRoomSmartTerrainState,
  serializeRoomSmartTerrainState,
  smartCellKey,
  smartDecorationSlotKey,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
} from '../../autotiling/model';
import {
  applySmartCells,
  fillEmptySmartTerrain,
  setSmartTerrainDetailsEnabled,
  suppressGeneratedDecorationAt,
  lockSmartTerrainCell,
  type SmartTerrainDocument,
} from '../../autotiling/solver';
import {
  applyManualSmartOutputEdit,
  clearSmartRecipeLayerState,
  planSmartRecipeLayerClear,
} from '../../autotiling/recipeSolver';
import { getGameSettings } from '../../settings/userSettings';
import { SmartTileController } from './smartTileController';

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

interface MusicAction {
  previous: RoomMusic | null;
  next: RoomMusic | null;
}

type UndoAction =
  | {
      kind: 'tiles';
      actions: TileAction[];
      smartBefore?: RoomSmartTerrainState;
      smartAfter?: RoomSmartTerrainState;
    }
  | { kind: 'objects'; action: ObjectsAction }
  | { kind: 'spawn'; action: SpawnAction }
  | { kind: 'goal'; action: GoalAction }
  | { kind: 'music'; action: MusicAction };

interface EditorRoomSnapshotMetadata {
  roomId: string;
  coordinates: RoomCoordinates;
  title: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export type { EditorClipboardState } from './clipboard';
export type { GoalPlacementMode } from './goalDocument';

interface EditorEditRuntimeHost {
  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer>;
  getTilemap(): Phaser.Tilemaps.Tilemap;
  getRoomSnapshotMetadata(): EditorRoomSnapshotMetadata;
  getRoomOrigin(): { x: number; y: number };
  getSelectedBackground(): string;
  setSelectedBackground(backgroundId: string): void;
  getSelectedLightingSettings(): RoomLightingSettings;
  setSelectedLightingSettings(lighting: RoomLightingSettings): void;
  getSelectedWeatherSettings(): RoomWeatherSettings;
  setSelectedWeatherSettings(weather: RoomWeatherSettings): void;
  getPlacedObjects(): PlacedObject[];
  setPlacedObjects(placedObjects: PlacedObject[]): void;
  updateBackgroundSelectValue(backgroundId: string): void;
  updateLightingControlsValue(lighting: RoomLightingSettings): void;
  updateWeatherControlsValue(weather: RoomWeatherSettings): void;
  updateBackground(): void;
  updateGoalUi(): void;
  syncBackgroundCameraIgnores(): void;
  updatePersistenceStatus(text: string): void;
  canSaveDraft(): boolean;
  recordBuildPlacement(count: number): void;
}

export class EditorEditRuntime {
  private readonly documentPresentation: EditorDocumentPresentationController;
  private readonly smartTiles: SmartTileController;
  private roomGoal: RoomGoal | null = null;
  private roomGoalIntroText: string | null = null;
  roomCameraMode: 'follow' | 'room' = 'follow';
  private roomSpawnPoint: RoomSpawnPoint | null = null;
  private roomMusic: RoomMusic | null = null;
  private roomDirty = false;
  private lastDirtyAt = 0;
  private goalPlacementMode: GoalPlacementMode = null;
  private readonly history = new EditorHistory<UndoAction>((action) => recordReplayEditorAction(`${action.kind}_changed`));
  private currentBatch: TileAction[] = [];
  private readonly currentBatchActionIndex = new Map<string, number>();
  private currentBatchSmartBefore: RoomSmartTerrainState | null = null;
  private currentSmartGestureAnchor: { x: number; y: number } | null = null;
  private smartTerrain = createRoomSmartTerrainState();
  private clipboardState: EditorClipboardState | null = null;
  private customRoomTiles: CustomRoomTileDefinition[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorEditRuntimeHost,
  ) {
    this.documentPresentation = new EditorDocumentPresentationController(
      scene,
      () => this.host.syncBackgroundCameraIgnores(),
    );
    this.smartTiles = new SmartTileController(() => ({
      brushId: editorState.smartMaterial,
      styleId: editorState.smartStyle,
      sourceLayer: getGameSettings().builderMode === 'advanced'
        ? editorState.activeLayer
        : undefined,
    }));
  }

  get placedObjectSprites(): Phaser.GameObjects.Sprite[] {
    return this.documentPresentation.placedObjectSprites;
  }

  get currentSpawnMarkerSprite(): Phaser.GameObjects.Sprite | null {
    return this.documentPresentation.currentSpawnMarkerSprite;
  }

  get currentGoalMarkerSprites(): Phaser.GameObjects.Sprite[] {
    return this.documentPresentation.currentGoalMarkerSprites;
  }

  get currentGoalMarkerLabels(): Phaser.GameObjects.Text[] {
    return this.documentPresentation.currentGoalMarkerLabels;
  }

  get currentRoomGoal(): RoomGoal | null {
    return this.roomGoal;
  }

  get currentRoomGoalIntroText(): string | null {
    return this.roomGoalIntroText;
  }

  get currentRoomSpawnPoint(): RoomSpawnPoint | null {
    return this.roomSpawnPoint;
  }

  get currentRoomMusic(): RoomMusic | null {
    return cloneRoomMusic(this.roomMusic);
  }

  getGoalIntroText(): string | null {
    return this.roomGoalIntroText;
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
    return cloneEditorClipboardState(this.clipboardState);
  }

  setClipboardState(state: EditorClipboardState | null): void {
    this.clipboardState = cloneEditorClipboardState(state);
  }

  initializeGraphics(): void {
    // Goal markers are sprite-backed; no persistent graphics overlay needed.
  }

  private getRoomOrigin(): { x: number; y: number } {
    return this.host.getRoomOrigin();
  }

  private toLocalWorldPoint(worldX: number, worldY: number): { x: number; y: number } {
    const origin = this.getRoomOrigin();
    return {
      x: worldX - origin.x,
      y: worldY - origin.y,
    };
  }

  private toWorldPoint(localX: number, localY: number): { x: number; y: number } {
    const origin = this.getRoomOrigin();
    return {
      x: origin.x + localX,
      y: origin.y + localY,
    };
  }

  private canEditRoom(): boolean {
    return this.host.canSaveDraft();
  }

  private guardEditable(): boolean {
    if (this.canEditRoom()) {
      return true;
    }

    this.host.updatePersistenceStatus('This room is read-only for this account.');
    return false;
  }

  reset(): void {
    this.documentPresentation.reset();

    this.roomGoal = null;
    this.roomGoalIntroText = null;
    this.roomCameraMode = 'follow';
    this.roomSpawnPoint = null;
    this.roomMusic = null;
    this.roomDirty = false;
    this.lastDirtyAt = 0;
    this.goalPlacementMode = null;
    this.history.reset();
    this.currentBatch = [];
    this.currentBatchActionIndex.clear();
    this.currentBatchSmartBefore = null;
    this.currentSmartGestureAnchor = null;
    this.objectBatchBefore = null;
    this.objectBatchNext = null;
    this.objectBatchChanged = false;
    this.objectBatchLivePreview = false;
    this.smartTerrain = createRoomSmartTerrainState();
    this.clipboardState = null;
    this.customRoomTiles = [];
  }

  applyRoomSnapshot(room: RoomSnapshot): void {
    const tileData = room.tileData;
    this.customRoomTiles = normalizeCustomRoomTileDefinitions(room.customTiles);
    this.smartTerrain = normalizeRoomSmartTerrainState(room.smartTerrain);
    editorState.smartDetailsEnabled = this.smartTerrain.detailsEnabled;
    this.syncCustomRoomTileset();

    for (const layerName of LAYER_NAMES) {
      const layer = this.host.getLayers().get(layerName);
      if (!layer) {
        continue;
      }

      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          // Compact overview snapshots may omit rows until the persisted room finishes loading.
          const encodedTileValue = tileData[layerName]?.[y]?.[x] ?? -1;
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

    this.host.setSelectedBackground(normalizeRoomBackground(room.background));
    editorState.selectedSolidBackgroundColor = getSolidColorFromBackgroundValue(
      room.background,
      editorState.selectedSolidBackgroundColor,
    );
    this.host.updateBackgroundSelectValue(normalizeRoomBackground(room.background));
    this.host.setSelectedLightingSettings(room.lighting);
    this.host.updateLightingControlsValue(room.lighting);
    this.host.setSelectedWeatherSettings(room.weather);
    this.host.updateWeatherControlsValue(room.weather);
    this.host.updateBackground();

    this.roomGoal = cloneRoomGoal(room.goal);
    this.roomGoalIntroText = normalizeRoomGoalIntroText(room.goalIntroText);
    this.roomCameraMode = room.cameraMode === 'room' ? 'room' : 'follow';
    this.roomSpawnPoint = room.spawnPoint ? { ...room.spawnPoint } : null;
    this.roomMusic = cloneRoomMusic(room.music);
    this.host.setPlacedObjects(room.placedObjects.map((placed) => ({ ...placed })));
    this.rebuildObjectSprites();
    this.host.updateGoalUi();

    this.history.reset();
    this.currentBatch = [];
    this.currentBatchActionIndex.clear();
    this.currentBatchSmartBefore = null;
    this.currentSmartGestureAnchor = null;
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

    this.clipboardState = buildEditorClipboardState(
      editorState.activeLayer,
      x1,
      y1,
      x2,
      y2,
      (x, y) => {
        const existingTile = layer.getTileAt(x, y);
        return existingTile
          ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
          : -1;
      },
      editorState.activeLayer === 'terrain'
        ? (x, y) => this.smartTerrain.cells[smartCellKey(x, y)]
        : editorState.activeLayer === 'background'
          ? (x, y) => this.smartTerrain.backdropCells[smartCellKey(x, y)]
          : undefined,
      this.smartTerrain,
    );
    return this.clipboardState !== null;
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
    for (const { x: tileX, y: tileY, encodedTileValue: newGid } of planEditorClipboardPaste(
      clipboard,
      baseTileX,
      baseTileY,
    )) {
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

        this.recordTileBatchAction({
          layer: editorState.activeLayer,
          x: tileX,
          y: tileY,
          oldGid,
          newGid,
        });
        this.recordManualSmartEdit(editorState.activeLayer, tileX, tileY, newGid);
        changed = true;
    }

    if (
      (editorState.activeLayer === 'terrain' || editorState.activeLayer === 'background')
      && clipboard.sourceLayer === editorState.activeLayer
      && clipboard.smartCells
    ) {
      let next = this.getSmartDocument();
      for (const [relativeKey, cell] of Object.entries(clipboard.smartCells)) {
        const [dx, dy] = relativeKey.split(',').map(Number);
        const x = baseTileX + dx;
        const y = baseTileY + dy;
        if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;
        next = applySmartCells(next, {
          cells: [{ x, y }], mode: 'paint', theme: cell.theme, material: cell.material,
        });
        const lockedValue = cell.lockedValue ?? cell.lockedGid;
        if (lockedValue) next = lockSmartTerrainCell(
          next, x, y, lockedValue, editorState.activeLayer,
        );
        changed = true;
      }
      this.applySmartDocument(next);
    }

    const smartPaste = planEditorSmartClipboardPaste(
      clipboard,
      baseTileX,
      baseTileY,
      editorState.activeLayer,
    );
    if (
      (smartPaste.semanticCells.length > 0 || smartPaste.recipes.length > 0)
      && !this.smartTerrain.editingDisabled
    ) {
      this.applySmartDocument(this.smartTiles.applyClipboardPlan(
        this.getSmartDocument(),
        smartPaste,
      ));
      changed = true;
    }

    return changed;
  }

  exportRoomSnapshot(): RoomSnapshot {
    const metadata = this.host.getRoomSnapshotMetadata();

    return {
      id: metadata.roomId,
      coordinates: { ...metadata.coordinates },
      title: metadata.title,
      cameraMode: this.roomCameraMode,
      goalIntroText: this.roomGoal ? normalizeRoomGoalIntroText(this.roomGoalIntroText) : null,
      background: normalizeRoomBackground(this.host.getSelectedBackground()),
      lighting: cloneRoomLightingSettings(this.host.getSelectedLightingSettings()),
      weather: cloneRoomWeatherSettings(this.host.getSelectedWeatherSettings()),
      music: cloneRoomMusic(this.roomMusic),
      goal: cloneRoomGoal(this.roomGoal),
      spawnPoint: this.roomSpawnPoint ? { ...this.roomSpawnPoint } : null,
      tileData: this.serializeTileData(),
      smartTerrain: serializeRoomSmartTerrainState(this.smartTerrain),
      placedObjects: this.host.getPlacedObjects().map((placed) => ({
        ...placed,
        customSpriteKind:
          getCustomSpriteDefinitionByObjectId(placed.id)?.kind ?? placed.customSpriteKind ?? null,
      })),
      customSprites: getCustomSpriteDefinitionsForPlacedObjects(this.host.getPlacedObjects()),
      customTiles: this.customRoomTiles.map((tile) => ({
        ...tile,
        pixels: [...tile.pixels],
      })),
      version: metadata.version,
      status: 'draft',
      createdAt: metadata.createdAt || new Date().toISOString(),
      updatedAt: metadata.updatedAt || new Date().toISOString(),
      publishedAt: metadata.publishedAt,
    };
  }

  useCustomSpriteAsTile(sprite: CustomSpriteDefinition): { gid: number; tile: CustomRoomTileDefinition } | null {
    if (!this.guardEditable()) {
      return null;
    }

    const existingIndex = findCustomRoomTileIndexForSourceSprite(this.customRoomTiles, sprite.id);
    const existingTile = existingIndex >= 0 ? this.customRoomTiles[existingIndex] : null;
    const nextTile = buildCustomRoomTileFromSprite(sprite, existingTile);
    if (!nextTile) {
      return null;
    }

    let nextIndex = existingIndex;
    if (existingIndex >= 0) {
      this.customRoomTiles = [
        ...this.customRoomTiles.slice(0, existingIndex),
        nextTile,
        ...this.customRoomTiles.slice(existingIndex + 1),
      ];
    } else {
      if (this.customRoomTiles.length >= CUSTOM_ROOM_TILE_MAX_TILES) {
        this.host.updatePersistenceStatus(`Room can use up to ${CUSTOM_ROOM_TILE_MAX_TILES} custom tiles.`);
        return null;
      }
      nextIndex = this.customRoomTiles.length;
      this.customRoomTiles = [...this.customRoomTiles, nextTile];
    }

    this.syncCustomRoomTileset();
    const gid = getCustomRoomTileGid(nextIndex);
    editorState.paletteMode = 'tiles';
    editorState.selectedObjectId = null;
    editorState.activeTool = 'pencil';
    editorState.selectedTileGid = gid;
    editorState.tileFlipXMode = 'off';
    editorState.tileFlipYMode = 'off';
    editorState.selection = {
      tilesetKey: `${CUSTOM_ROOM_TILESET_KEY_PREFIX}:${nextTile.id}`,
      startCol: 0,
      startRow: 0,
      width: 1,
      height: 1,
      occupiedMask: [[true]],
    };
    this.markRoomDirty();

    return { gid, tile: nextTile };
  }

  beginTileBatch(): void {
    if (!this.guardEditable()) {
      this.currentBatch = [];
      this.currentBatchActionIndex.clear();
      this.currentBatchSmartBefore = null;
      this.currentSmartGestureAnchor = null;
      return;
    }
    this.currentBatch = [];
    this.currentBatchActionIndex.clear();
    this.currentBatchSmartBefore = cloneRoomSmartTerrainState(this.smartTerrain);
    this.currentSmartGestureAnchor = null;
  }

  private objectBatchBefore: PlacedObject[] | null = null;
  private objectBatchNext: PlacedObject[] | null = null;
  private objectBatchChanged = false;
  private objectBatchLivePreview = false;

  beginObjectBatch(livePreview = false): void {
    if (!this.guardEditable()) return;
    this.objectBatchBefore = this.clonePlacedObjects();
    this.objectBatchNext = this.clonePlacedObjects(this.objectBatchBefore);
    this.objectBatchChanged = false;
    this.objectBatchLivePreview = livePreview;
  }

  commitObjectBatch(): void {
    const previous = this.objectBatchBefore;
    const next = this.objectBatchNext;
    const changed = this.objectBatchChanged;
    this.objectBatchBefore = null;
    this.objectBatchNext = null;
    this.objectBatchChanged = false;
    this.objectBatchLivePreview = false;
    if (!previous || !next || !changed) {
      return;
    }
    this.host.setPlacedObjects(next);
    this.history.record({ kind: 'objects', action: { previous, next: this.clonePlacedObjects(next) } });
    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  commitTileBatch(): void {
    const actions = this.currentBatch.filter((action) => action.oldGid !== action.newGid);
    const smartChanged = this.currentBatchSmartBefore !== null
      && JSON.stringify(this.currentBatchSmartBefore) !== JSON.stringify(this.smartTerrain);
    if (actions.length === 0 && !smartChanged) {
      this.currentBatch = [];
      this.currentBatchActionIndex.clear();
      this.currentBatchSmartBefore = null;
      this.currentSmartGestureAnchor = null;
      return;
    }

    const placedTileCount = actions.filter((action) => action.newGid >= 0).length;
    this.history.record({
      kind: 'tiles',
      actions,
      smartBefore: this.currentBatchSmartBefore
        ? cloneRoomSmartTerrainState(this.currentBatchSmartBefore)
        : undefined,
      smartAfter: cloneRoomSmartTerrainState(this.smartTerrain),
    });
    this.currentBatch = [];
    this.currentBatchActionIndex.clear();
    this.currentBatchSmartBefore = null;
    this.currentSmartGestureAnchor = null;
    this.markRoomDirty();
    this.host.recordBuildPlacement(placedTileCount);
  }

  clearTileBatch(): void {
    this.currentBatch = [];
    this.currentBatchActionIndex.clear();
    this.currentBatchSmartBefore = null;
    this.currentSmartGestureAnchor = null;
  }

  private recordTileBatchAction(action: TileAction): void {
    if (action.oldGid === action.newGid) return;
    const key = `${action.layer}:${action.x},${action.y}`;
    const existingIndex = this.currentBatchActionIndex.get(key);
    if (existingIndex === undefined) {
      this.currentBatchActionIndex.set(key, this.currentBatch.length);
      this.currentBatch.push(action);
      return;
    }
    const existing = this.currentBatch[existingIndex];
    if (existing) existing.newGid = action.newGid;
  }

  private getSmartDocument(): SmartTerrainDocument {
    return {
      tileData: this.serializeTileData(),
      smartTerrain: cloneRoomSmartTerrainState(this.smartTerrain),
    };
  }

  private recordManualSmartEdit(layer: LayerName, x: number, y: number, value: number): void {
    this.smartTerrain = applyManualSmartOutputEdit(this.smartTerrain, layer, x, y, value);
    const key = smartCellKey(x, y);
    const legacy = layer === 'terrain'
      ? this.smartTerrain.cells[key]
      : layer === 'background'
        ? this.smartTerrain.backdropCells[key]
        : undefined;
    if (legacy) {
      legacy.lockedValue = value;
      legacy.lockedGid = value;
      const semantic = this.smartTerrain.semanticCells[smartSemanticCellKey(layer, x, y)];
      if (semantic) semantic.lockedValue = value;
    }
  }

  private applySmartDocument(next: SmartTerrainDocument): void {
    if (this.smartTerrain.editingDisabled) {
      this.host.updatePersistenceStatus(
        this.smartTerrain.editingDisabledReason
          ?? 'Smart editing is disabled because this room uses a newer Smart Tile format.',
      );
      return;
    }
    const previous = this.serializeTileData();
    for (const layerName of LAYER_NAMES) {
      const layer = this.host.getLayers().get(layerName);
      if (!layer) continue;
      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          const oldGid = previous[layerName][y]?.[x] ?? -1;
          const newGid = next.tileData[layerName][y]?.[x] ?? -1;
          if (oldGid === newGid) continue;
          if (newGid < 0) {
            layer.removeTileAt(x, y);
          } else {
            const decoded = decodeTileDataValue(newGid);
            const tile = layer.putTileAt(decoded.gid, x, y);
            if (tile) {
              tile.flipX = decoded.flipX;
              tile.flipY = decoded.flipY;
            }
          }
          this.recordTileBatchAction({ layer: layerName, x, y, oldGid, newGid });
        }
      }
    }
    this.smartTerrain = cloneRoomSmartTerrainState(next.smartTerrain);
  }

  setSmartDetailsEnabled(enabled: boolean): void {
    this.beginTileBatch();
    this.applySmartDocument(setSmartTerrainDetailsEnabled(this.getSmartDocument(), enabled));
    editorState.smartDetailsEnabled = enabled;
    this.commitTileBatch();
  }

  fillCaveTerrain(): void {
    this.beginTileBatch();
    this.applySmartDocument(fillEmptySmartTerrain(this.getSmartDocument(), 'cave'));
    this.commitTileBatch();
  }

  setRoomMusic(nextMusic: RoomMusic | null): RoomMusic | null {
    if (!this.guardEditable()) {
      return cloneRoomMusic(this.roomMusic);
    }

    const previous = cloneRoomMusic(this.roomMusic);
    const normalizedNext =
      nextMusic && !isRoomMusicEmpty(nextMusic)
        ? cloneRoomMusic(nextMusic)
        : null;
    if (!this.roomMusicChanged(previous, normalizedNext)) {
      return cloneRoomMusic(this.roomMusic);
    }

    this.roomMusic = cloneRoomMusic(normalizedNext);
    this.history.record({
      kind: 'music',
      action: {
        previous,
        next: cloneRoomMusic(normalizedNext),
      },
    });
    this.markRoomDirty();
    return cloneRoomMusic(this.roomMusic);
  }

  replaceRoomMusicWithPattern(): RoomMusic | null {
    return this.setRoomMusic(createDefaultRoomPatternMusic());
  }

  private clonePlacedObjects(placedObjects: PlacedObject[] = this.host.getPlacedObjects()): PlacedObject[] {
    return clonePlacedObjectDocument(placedObjects);
  }

  /** World-space stamp origins from one interpolated pointer segment. */
  placeTileStroke(points: readonly { x: number; y: number }[]): void {
    if (!this.guardEditable() || points.length === 0) return;
    if (editorState.paletteMode !== 'smart') {
      for (const point of points) this.placeTileAt(point.x, point.y);
      return;
    }
    const cells = points.map((point) => {
      const local = this.toLocalWorldPoint(point.x, point.y);
      const normalized = this.smartTiles.normalizeStrokeCell(
        { x: Math.floor(local.x / TILE_SIZE), y: Math.floor(local.y / TILE_SIZE) },
        this.currentSmartGestureAnchor,
      );
      this.currentSmartGestureAnchor = normalized.anchor;
      return normalized.cell;
    });
    this.applySmartDocument(this.smartTiles.applyStrokeCells(this.getSmartDocument(), cells));
  }

  placeTileAt(worldX: number, worldY: number): void {
    if (!this.guardEditable()) {
      return;
    }
    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    const baseTileX = Math.floor(localPoint.x / TILE_SIZE);
    const baseTileY = Math.floor(localPoint.y / TILE_SIZE);
    if (editorState.paletteMode === 'smart') {
      this.placeTileStroke([{ x: worldX, y: worldY }]);
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }

    if (editorState.paletteMode === 'tiles' && isPencilBrushPlacement()) {
      this.paintPencilBrushAt(layer, worldX, worldY);
      return;
    }

    const selection = editorState.selection;
    for (let dy = 0; dy < selection.height; dy += 1) {
      for (let dx = 0; dx < selection.width; dx += 1) {
        const tileX = baseTileX + dx;
        const tileY = baseTileY + dy;
        const newGid = applyEditorTileFlipModes(getSelectionTileValue(dx, dy));
        this.writeEncodedTile(layer, tileX, tileY, newGid);
      }
    }
  }

  private paintPencilBrushAt(
    layer: Phaser.Tilemaps.TilemapLayer,
    worldX: number,
    worldY: number,
  ): void {
    const size = clampRandomizeBrushSize(editorState.pencilBrushSize);
    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    const centerX = Math.floor(localPoint.x / TILE_SIZE);
    const centerY = Math.floor(localPoint.y / TILE_SIZE);
    const originX = centerX - Math.floor(size * 0.5);
    const originY = centerY - Math.floor(size * 0.5);
    const pool = editorState.shapeFillMode === 'pattern'
      ? getOrderedSelectionValues(editorState.selection, getSelectionTileValue)
      : collectOccupiedSelectionValues(editorState.selection, getSelectionTileValue);
    const sampled = editorState.shapeFillMode === 'pattern'
      ? samplePatternWindow(size, originX, originY, pool)
      : sampleDrawWindow(size, pool);
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        this.writeEncodedTile(
          layer,
          originX + dx,
          originY + dy,
          applyEditorTileFlipModes(sampled[dy]?.[dx] ?? -1),
        );
      }
    }
  }

  private writeEncodedTile(
    layer: Phaser.Tilemaps.TilemapLayer,
    tileX: number,
    tileY: number,
    newGid: number,
  ): void {
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT || newGid < 0) {
      return;
    }
    const existingTile = layer.getTileAt(tileX, tileY);
    const oldGid = existingTile
      ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
      : -1;
    if (oldGid === newGid) {
      return;
    }
    const decoded = decodeTileDataValue(newGid);
    const placedTile = layer.putTileAt(decoded.gid, tileX, tileY);
    if (placedTile) {
      placedTile.flipX = decoded.flipX;
      placedTile.flipY = decoded.flipY;
    }
    this.recordTileBatchAction({
      layer: editorState.activeLayer,
      x: tileX,
      y: tileY,
      oldGid,
      newGid,
    });
    this.recordManualSmartEdit(editorState.activeLayer, tileX, tileY, newGid);
  }

  paintRandomizeAt(worldX: number, worldY: number): void {
    if (!this.guardEditable() || editorState.paletteMode === 'smart') {
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }

    const size = clampRandomizeBrushSize(editorState.randomizeBrushSize);
    const forceRandom = isScrambleOneByOne(size);
    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    const centerX = Math.floor(localPoint.x / TILE_SIZE);
    const centerY = Math.floor(localPoint.y / TILE_SIZE);
    const originX = centerX - Math.floor(size * 0.5);
    const originY = centerY - Math.floor(size * 0.5);
    const current: number[][] = [];
    for (let dy = 0; dy < size; dy += 1) {
      const row: number[] = [];
      for (let dx = 0; dx < size; dx += 1) {
        const tileX = originX + dx;
        const tileY = originY + dy;
        if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
          row.push(-1);
          continue;
        }
        const existingTile = layer.getTileAt(tileX, tileY);
        row.push(
          existingTile
            ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
            : -1,
        );
      }
      current.push(row);
    }

    const stamped = scrambleWindow(current);
    const next = stamped.map((row) => row.map((value) => (
      applyEditorTileFlipModes(value, { forceRandom })
    )));

    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const tileX = originX + dx;
        const tileY = originY + dy;
        if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
          continue;
        }
        const newGid = next[dy]?.[dx] ?? -1;
        const oldGid = current[dy]?.[dx] ?? -1;
        if (oldGid === newGid) {
          continue;
        }
        if (newGid < 0) {
          layer.removeTileAt(tileX, tileY);
        } else {
          const decoded = decodeTileDataValue(newGid);
          const placedTile = layer.putTileAt(decoded.gid, tileX, tileY);
          if (placedTile) {
            placedTile.flipX = decoded.flipX;
            placedTile.flipY = decoded.flipY;
          }
        }
        this.recordTileBatchAction({
          layer: editorState.activeLayer,
          x: tileX,
          y: tileY,
          oldGid,
          newGid,
        });
        this.recordManualSmartEdit(editorState.activeLayer, tileX, tileY, newGid);
      }
    }
  }

  eraseTileAt(worldX: number, worldY: number): void {
    if (!this.guardEditable()) {
      return;
    }

    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    const tileX = Math.floor(localPoint.x / TILE_SIZE);
    const tileY = Math.floor(localPoint.y / TILE_SIZE);
    const randomizeErase = editorState.activeTool === 'randomize';
    const brushSize = randomizeErase
      ? clampRandomizeBrushSize(editorState.randomizeBrushSize)
      : Math.max(1, editorState.eraserBrushSize);
    if (editorState.paletteMode === 'smart') {
      const radius = Math.floor(brushSize * 0.5);
      const cells = [];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) cells.push({ x: tileX + dx, y: tileY + dy });
      }
      let document = this.getSmartDocument();
      let suppressedDecoration = false;
      for (const cell of cells) {
        const key = smartCellKey(cell.x, cell.y);
        if (
          (document.smartTerrain.generatedDecorations[key]
            || document.smartTerrain.generatedBackgroundDecorations[key])
          && !document.smartTerrain.cells[key]
        ) {
          document = suppressGeneratedDecorationAt(document, cell.x, cell.y);
          suppressedDecoration = true;
        }
      }
      if (suppressedDecoration) {
        this.applySmartDocument(document);
        return;
      }
      this.applySmartDocument(this.smartTiles.applyCells(document, cells, 'erase'));
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }

    const originX = tileX - Math.floor(brushSize * 0.5);
    const originY = tileY - Math.floor(brushSize * 0.5);
    for (let dy = 0; dy < brushSize; dy += 1) {
      for (let dx = 0; dx < brushSize; dx += 1) {
        this.eraseLayerCell(layer, originX + dx, originY + dy);
      }
    }
  }

  eraseStampAt(worldX: number, worldY: number): void {
    if (!this.guardEditable()) {
      return;
    }
    if (editorState.paletteMode === 'smart') {
      this.eraseTileAt(worldX, worldY);
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer) {
      return;
    }
    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    const originX = Math.floor(localPoint.x / TILE_SIZE);
    const originY = Math.floor(localPoint.y / TILE_SIZE);
    if (isPencilBrushPlacement()) {
      const size = clampRandomizeBrushSize(editorState.pencilBrushSize);
      const brushOriginX = originX - Math.floor(size * 0.5);
      const brushOriginY = originY - Math.floor(size * 0.5);
      for (let dy = 0; dy < size; dy += 1) {
        for (let dx = 0; dx < size; dx += 1) {
          this.eraseLayerCell(layer, brushOriginX + dx, brushOriginY + dy);
        }
      }
      return;
    }
    const selection = editorState.selection;
    for (let dy = 0; dy < selection.height; dy += 1) {
      for (let dx = 0; dx < selection.width; dx += 1) {
        if (!selection.occupiedMask[dy]?.[dx]) {
          continue;
        }
        this.eraseLayerCell(layer, originX + dx, originY + dy);
      }
    }
  }

  private eraseLayerCell(
    layer: Phaser.Tilemaps.TilemapLayer,
    targetX: number,
    targetY: number,
  ): void {
    if (targetX < 0 || targetX >= ROOM_WIDTH || targetY < 0 || targetY >= ROOM_HEIGHT) {
      return;
    }

    const existingTile = layer.getTileAt(targetX, targetY);
    if (!existingTile) {
      return;
    }

    const oldGid = encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY);
    layer.removeTileAt(targetX, targetY);
    this.recordManualSmartEdit(editorState.activeLayer, targetX, targetY, -1);
    if (editorState.activeLayer === 'terrain') {
      const slot = smartCellKey(targetX, targetY);
      if (this.smartTerrain.cells[slot]) {
        delete this.smartTerrain.cells[slot];
      } else if (
        this.smartTerrain.generatedDecorations[slot]?.layer === 'terrain'
        || this.smartTerrain.generatedBackgroundDecorations[slot]?.layer === 'terrain'
      ) {
        this.smartTerrain = suppressGeneratedDecorationAt(
          this.getSmartDocument(), targetX, targetY, 'terrain',
        ).smartTerrain;
      }
    } else if (editorState.activeLayer === 'foreground' || editorState.activeLayer === 'background') {
      const slot = smartCellKey(targetX, targetY);
      if (editorState.activeLayer === 'background') delete this.smartTerrain.backdropCells[slot];
      if (
        this.smartTerrain.generatedDecorations[slot]?.layer === editorState.activeLayer
        || this.smartTerrain.generatedBackgroundDecorations[slot]?.layer === editorState.activeLayer
      ) {
        this.smartTerrain = suppressGeneratedDecorationAt(
          this.getSmartDocument(), targetX, targetY, editorState.activeLayer,
        ).smartTerrain;
      }
    }
    this.recordTileBatchAction({
      layer: editorState.activeLayer,
      x: targetX,
      y: targetY,
      oldGid,
      newGid: -1,
    });
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
    const smartBefore = cloneRoomSmartTerrainState(this.smartTerrain);
    const recipeClearPlan = planSmartRecipeLayerClear(smartBefore, editorState.activeLayer);
    for (const output of recipeClearPlan.removedOutputs) {
      if (output.layer === editorState.activeLayer) continue;
      const { x, y } = output;
      const outputLayer = this.host.getLayers().get(output.layer);
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
        this.smartTerrain.generatedDecorations,
        this.smartTerrain.generatedBackgroundDecorations,
      ]) {
        for (const [targetKey, decoration] of Object.entries(generated)) {
          const [x, y] = targetKey.split(',').map(Number);
          const detailLayer = this.host.getLayers().get(decoration.layer);
          const tile = detailLayer?.getTileAt(x, y);
          const encoded = tile
            ? encodeTileDataValue(tile.index, tile.flipX, tile.flipY)
            : -1;
          if (!tile || encoded !== (decoration.value ?? decoration.gid)) continue;
          detailLayer?.removeTileAt(x, y);
          actions.push({ layer: decoration.layer, x, y, oldGid: encoded, newGid: -1 });
        }
      }
      this.smartTerrain.cells = {};
      this.smartTerrain.generatedDecorations = {};
      this.smartTerrain.generatedBackgroundDecorations = {};
      this.smartTerrain.suppressedDecorationSlots = [];
    } else if (editorState.activeLayer === 'foreground' || editorState.activeLayer === 'background') {
      if (editorState.activeLayer === 'background') this.smartTerrain.backdropCells = {};
      for (const generated of [
        this.smartTerrain.generatedDecorations,
        this.smartTerrain.generatedBackgroundDecorations,
      ]) {
        for (const [targetKey, decoration] of Object.entries(generated)) {
          if (decoration.layer !== editorState.activeLayer) continue;
          this.smartTerrain.suppressedDecorationSlots = Array.from(new Set([
            ...this.smartTerrain.suppressedDecorationSlots,
            smartDecorationSlotKey(decoration.ownerKey, decoration.slot),
          ]));
          delete generated[targetKey];
        }
      }
    }
    this.smartTerrain = clearSmartRecipeLayerState(this.smartTerrain, editorState.activeLayer);
    if (actions.length === 0 && JSON.stringify(smartBefore) === JSON.stringify(this.smartTerrain)) {
      return;
    }
    this.history.record({
      kind: 'tiles', actions, smartBefore, smartAfter: cloneRoomSmartTerrainState(this.smartTerrain),
    });
    this.markRoomDirty();
  }

  clearAllTiles(): void {
    if (!this.guardEditable()) {
      return;
    }

    const actions: TileAction[] = [];
    const smartBefore = cloneRoomSmartTerrainState(this.smartTerrain);
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

    const clearedSmartTerrain = createRoomSmartTerrainState();
    if (actions.length === 0 && JSON.stringify(smartBefore) === JSON.stringify(clearedSmartTerrain)) {
      return;
    }

    this.smartTerrain = clearedSmartTerrain;
    this.history.record({
      kind: 'tiles', actions, smartBefore, smartAfter: cloneRoomSmartTerrainState(this.smartTerrain),
    });
    this.markRoomDirty();
  }

  clearAllObjects(): void {
    if (!this.guardEditable()) {
      return;
    }

    const previous = this.clonePlacedObjects();
    if (previous.length === 0) {
      return;
    }

    this.host.setPlacedObjects([]);
    this.history.record({
      kind: 'objects',
      action: { previous, next: [] },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  fillRect(x1: number, y1: number, x2: number, y2: number): void {
    this.stampShape('rect', x1, y1, x2, y2, {
      outline: editorState.rectOutline,
      erase: false,
    });
  }

  stampShape(
    kind: EditorShapeKind,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: { outline?: boolean; erase?: boolean; mid?: TilePoint },
  ): void {
    if (!this.guardEditable()) {
      return;
    }
    const erase = Boolean(options?.erase);
    const outline = Boolean(options?.outline);
    if (editorState.paletteMode === 'smart') {
      const constrainedCells = kind === 'rect' && !erase
        ? this.smartTiles.getRectangleCells(x1, y1, x2, y2)
        : null;
      if (constrainedCells) {
        this.applySmartDocument(this.smartTiles.applyCells(
          this.getSmartDocument(),
          constrainedCells,
          'paint',
        ));
        return;
      }
      const cells = iterateShapeTiles(kind, x1, y1, x2, y2, outline, options?.mid);
      const document = this.getSmartDocument();
      this.applySmartDocument(
        outline && !erase
          ? this.smartTiles.applyOutlineCells(
              document,
              iterateShapeTiles(kind, x1, y1, x2, y2, false, options?.mid),
              cells,
            )
          : this.smartTiles.applyCells(document, cells, erase ? 'erase' : 'paint'),
      );
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer || (!erase && editorState.selectedTileGid < 0)) {
      return;
    }

    const pool = erase ? [] : getOrderedSelectionValues(editorState.selection, getSelectionTileValue);
    const origin = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
    const tiles = iterateShapeTiles(kind, x1, y1, x2, y2, outline, options?.mid);
    for (let step = 0; step < tiles.length; step += 1) {
      const tile = tiles[step]!;
      if (tile.x < 0 || tile.x >= ROOM_WIDTH || tile.y < 0 || tile.y >= ROOM_HEIGHT) {
        continue;
      }

      const newGid = erase ? -1 : applyEditorTileFlipModes(this.resolveMultiTileStampValue(kind, tile, step, origin, pool));
      const existingTile = layer.getTileAt(tile.x, tile.y);
      const oldGid = existingTile
        ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
        : -1;
      if (oldGid === newGid) {
        continue;
      }

      if (erase || newGid < 0) {
        if (!existingTile) {
          continue;
        }
        layer.removeTileAt(tile.x, tile.y);
      } else {
        const decoded = decodeTileDataValue(newGid);
        const placedTile = layer.putTileAt(decoded.gid, tile.x, tile.y);
        if (placedTile) {
          placedTile.flipX = decoded.flipX;
          placedTile.flipY = decoded.flipY;
        }
      }
      this.recordTileBatchAction({
        layer: editorState.activeLayer,
        x: tile.x,
        y: tile.y,
        oldGid,
        newGid: erase ? -1 : newGid,
      });
      this.recordManualSmartEdit(editorState.activeLayer, tile.x, tile.y, erase ? -1 : newGid);
    }
  }

  private resolveMultiTileStampValue(
    kind: EditorShapeKind | 'fill',
    tile: TilePoint,
    step: number,
    origin: TilePoint,
    pool: number[],
  ): number {
    if (pool.length === 0) {
      return -1;
    }
    if (editorState.shapeFillMode === 'shuffle' && pool.length > 1) {
      return pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))] ?? -1;
    }
    if (kind === 'line' || kind === 'curve') {
      return pool[pathPatternIndex(step, pool.length)] ?? -1;
    }
    return pool[diagonalPatternIndex(tile.x - origin.x, tile.y - origin.y, pool.length)] ?? -1;
  }

  floodFill(startX: number, startY: number): void {
    if (editorState.paletteMode === 'smart') {
      this.floodReplace(startX, startY, getSelectionTileValue(0, 0));
      return;
    }
    const pool = getOrderedSelectionValues(editorState.selection, getSelectionTileValue);
    if (pool.length <= 1) {
      this.floodReplace(startX, startY, pool[0] ?? getSelectionTileValue(0, 0));
      return;
    }
    this.floodPaintPattern(startX, startY, pool);
  }

  floodErase(startX: number, startY: number): void {
    this.floodReplace(startX, startY, -1);
  }

  floodFillObjects(startX: number, startY: number): number {
    if (!this.guardEditable() || !canRepeatSelectedEditorObject()) return 0;
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer || startX < 0 || startX >= ROOM_WIDTH || startY < 0 || startY >= ROOM_HEIGHT) return 0;

    const tileValue = (x: number, y: number): number => {
      const tile = layer.getTileAt(x, y);
      return tile ? encodeTileDataValue(tile.index, tile.flipX, tile.flipY) : -1;
    };
    const target = tileValue(startX, startY);
    const occupied = new Set(this.host.getPlacedObjects().flatMap((placed) => {
      const cell = getPlacedObjectAnchorCell(placed);
      return cell && cell.layer === editorState.activeLayer ? [`${cell.tileX},${cell.tileY}`] : [];
    }));
    const visited = new Set<string>();
    const queue: Array<[number, number]> = [[startX, startY]];
    let placed = 0;
    this.beginObjectBatch();
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index];
      if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!encodedTilesMatchForFlood(tileValue(x, y), target, editorState.fillIgnoreTileFlipping)) continue;
      if (!occupied.has(key) && this.handleObjectPlace(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, x, y)) {
        placed += 1;
      }
      queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
    this.commitObjectBatch();
    return placed;
  }

  private floodPaintPattern(startX: number, startY: number, pool: number[]): void {
    if (!this.guardEditable() || pool.length === 0) {
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (!layer || startX < 0 || startX >= ROOM_WIDTH || startY < 0 || startY >= ROOM_HEIGHT) {
      return;
    }

    const startTile = layer.getTileAt(startX, startY);
    const targetGid = startTile
      ? encodeTileDataValue(startTile.index, startTile.flipX, startTile.flipY)
      : -1;
    const ignoreTileFlipping = editorState.fillIgnoreTileFlipping;
    const cells: TilePoint[] = [];
    const visited = new Set<string>();
    const queue: Array<[number, number]> = [[startX, startY]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;
      if (visited.has(key) || x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) {
        continue;
      }
      const tile = layer.getTileAt(x, y);
      const currentGid = tile
        ? encodeTileDataValue(tile.index, tile.flipX, tile.flipY)
        : -1;
      if (!encodedTilesMatchForFlood(currentGid, targetGid, ignoreTileFlipping)) {
        continue;
      }
      visited.add(key);
      cells.push({ x, y });
      queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
    if (cells.length === 0) {
      return;
    }

    const origin = {
      x: Math.min(...cells.map((cell) => cell.x)),
      y: Math.min(...cells.map((cell) => cell.y)),
    };
    for (const cell of cells) {
      const newGid = applyEditorTileFlipModes(this.resolveMultiTileStampValue('fill', cell, 0, origin, pool));
      const existingTile = layer.getTileAt(cell.x, cell.y);
      const oldGid = existingTile
        ? encodeTileDataValue(existingTile.index, existingTile.flipX, existingTile.flipY)
        : -1;
      if (oldGid === newGid) {
        continue;
      }
      if (newGid < 0) {
        layer.removeTileAt(cell.x, cell.y);
      } else {
        const decoded = decodeTileDataValue(newGid);
        const placedTile = layer.putTileAt(decoded.gid, cell.x, cell.y);
        if (placedTile) {
          placedTile.flipX = decoded.flipX;
          placedTile.flipY = decoded.flipY;
        }
      }
      this.recordTileBatchAction({
        layer: editorState.activeLayer,
        x: cell.x,
        y: cell.y,
        oldGid,
        newGid,
      });
      this.recordManualSmartEdit(editorState.activeLayer, cell.x, cell.y, newGid);
    }
  }

  private floodReplace(startX: number, startY: number, replacementGid: number): void {
    if (!this.guardEditable()) {
      return;
    }
    const layer = this.host.getLayers().get(editorState.activeLayer);
    if (editorState.paletteMode === 'smart') {
      if (!layer || startX < 0 || startX >= ROOM_WIDTH || startY < 0 || startY >= ROOM_HEIGHT) return;
      const startTile = layer.getTileAt(startX, startY);
      const targetGid = startTile?.index ?? -1;
      const cells: Array<{ x: number; y: number }> = [];
      const visited = new Set<string>();
      const queue: Array<[number, number]> = [[startX, startY]];
      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        const key = smartCellKey(x, y);
        if (visited.has(key) || x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;
        visited.add(key);
        if ((layer.getTileAt(x, y)?.index ?? -1) !== targetGid) continue;
        cells.push({ x, y });
        queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
      }
      this.applySmartDocument(this.smartTiles.applyCells(
        this.getSmartDocument(),
        cells,
        replacementGid < 0 ? 'erase' : 'paint',
      ));
      return;
    }
    if (!layer || (replacementGid >= 0 && editorState.selectedTileGid < 0)) {
      return;
    }

    const targetTile = layer.getTileAt(startX, startY);
    const targetGid = targetTile
      ? encodeTileDataValue(targetTile.index, targetTile.flipX, targetTile.flipY)
      : -1;
    const ignoreTileFlipping = editorState.fillIgnoreTileFlipping;
    const randomFlips = editorState.tileFlipXMode === 'rand' || editorState.tileFlipYMode === 'rand';
    if (!ignoreTileFlipping && !randomFlips && targetGid === replacementGid) {
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
      if (!encodedTilesMatchForFlood(currentGid, targetGid, ignoreTileFlipping)) {
        continue;
      }

      visited.add(key);
      const newGid = replacementGid < 0 ? -1 : applyEditorTileFlipModes(replacementGid);
      if (currentGid !== newGid) {
        if (newGid < 0) {
          layer.removeTileAt(x, y);
        } else {
          const decoded = decodeTileDataValue(newGid);
          const placedTile = layer.putTileAt(decoded.gid, x, y);
          if (placedTile) {
            placedTile.flipX = decoded.flipX;
            placedTile.flipY = decoded.flipY;
          }
        }
        this.recordTileBatchAction({
          layer: editorState.activeLayer,
          x,
          y,
          oldGid: currentGid,
          newGid,
        });
        this.recordManualSmartEdit(editorState.activeLayer, x, y, newGid);
      }

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

    const objectConfig = getEditorObjectConfigById(editorState.selectedObjectId);
    if (!objectConfig) {
      return null;
    }

    if (objectConfig.id === 'spawn_point') {
      this.placeSpawnPoint(tileX, tileY);
      const editorWindow = this.scene.game?.canvas?.ownerDocument.defaultView;
      editorWindow?.dispatchEvent(new editorWindow.Event(EDITOR_SPAWN_PLACED_EVENT));
      return null;
    }

    const placementPoint = getObjectPlacementPointForTile(objectConfig, tileX, tileY);
    const placed: PlacedObject = {
      id: editorState.selectedObjectId,
      x: placementPoint.x,
      y: placementPoint.y,
      instanceId: createPlacedObjectInstanceId(),
      customSpriteKind: getCustomSpriteDefinitionByObjectId(editorState.selectedObjectId)?.kind ?? null,
      facing: objectConfig.facingDirection ? editorState.objectFacing : undefined,
      layer: editorState.activeLayer,
      triggerTargetInstanceId: null,
      linkedTargetInstanceIds: null,
      containedObjectId: null,
      signText: null,
      swordsmanObjectiveMode:
        editorState.selectedObjectId === SWORDSMAN_AI_OBJECT_ID
          ? DEFAULT_SWORDSMAN_OBJECTIVE_MODE
          : null,
      swordsmanDefeatMode:
        editorState.selectedObjectId === SWORDSMAN_AI_OBJECT_ID
          ? DEFAULT_SWORDSMAN_DEFEAT_MODE
          : null,
      policeBehaviorMode: isPoliceEnemyObjectId(editorState.selectedObjectId)
        ? DEFAULT_POLICE_BEHAVIOR_MODE
        : null,
      policePatrolShoots: isPoliceEnemyObjectId(editorState.selectedObjectId)
        ? DEFAULT_POLICE_PATROL_SHOOTS
        : null,
      npcMode: isNpcObjectId(editorState.selectedObjectId) ? DEFAULT_NPC_MODE : null,
      npcPushable: isNpcObjectId(editorState.selectedObjectId) ? false : null,
      npcCanJumpFall: isNpcObjectId(editorState.selectedObjectId) ? false : null,
      npcPlayerCollision: isNpcObjectId(editorState.selectedObjectId)
        ? DEFAULT_NPC_PLAYER_COLLISION
        : null,
      npcFriendlyFire: isNpcObjectId(editorState.selectedObjectId)
        ? DEFAULT_NPC_FRIENDLY_FIRE
        : null,
      npcName: isNpcObjectId(editorState.selectedObjectId) ? objectConfig.name : null,
      npcDefeatMode: isNpcObjectId(editorState.selectedObjectId)
        ? DEFAULT_NPC_DEFEAT_MODE
        : null,
    };

    const previous = this.objectBatchNext ?? this.clonePlacedObjects();
    const targetCell = createPlacedObjectAnchorCell(tileX, tileY, editorState.activeLayer);
    const conflict = findConflictingPlacedObjectAtAnchorCell(previous, targetCell, placed);
    if (
      conflict &&
      conflict.placed.id === placed.id &&
      conflict.placed.facing === placed.facing
    ) {
      return conflict.placed;
    }

    const next = conflict
      ? previous
          .filter((_, index) => index !== conflict.index)
          .map((candidate) =>
            this.removeLinkedTargetFromPlacedObject(candidate, conflict.placed.instanceId)
          )
          .concat(placed)
      : [...previous, placed];
    if (this.objectBatchNext) {
      this.objectBatchNext = next;
      this.objectBatchChanged = true;
      if (this.objectBatchLivePreview) {
        this.host.setPlacedObjects(next);
        this.rebuildObjectSprites();
      }
    } else {
      this.host.setPlacedObjects(next);
      this.history.record({
        kind: 'objects',
        action: { previous, next: this.clonePlacedObjects(next) },
      });
      this.rebuildObjectSprites();
      this.markRoomDirty();
    }
    this.host.recordBuildPlacement(1);
    return placed;
  }

  removeObjectAt(worldX: number, worldY: number): PlacedObject | null {
    if (!this.guardEditable()) {
      return null;
    }
    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    if (this.roomSpawnPoint) {
      const spawnDist = Math.hypot(this.roomSpawnPoint.x - localPoint.x, this.roomSpawnPoint.y - localPoint.y);
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
    const placedObjects = this.host.getPlacedObjects();
    for (let i = placedObjects.length - 1; i >= 0; i -= 1) {
      const placed = placedObjects[i];
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
    const removal = removePlacedObjectFromDocument(previous, previous[bestIndex].instanceId);
    const removed = removal.removed!;
    const next = removal.placedObjects;
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return removed;
  }

  canRemoveObjectAt(worldX: number, worldY: number): boolean {
    const localPoint = this.toLocalWorldPoint(worldX, worldY);
    if (this.roomSpawnPoint) {
      const spawnDist = Math.hypot(this.roomSpawnPoint.x - localPoint.x, this.roomSpawnPoint.y - localPoint.y);
      if (spawnDist < 14) {
        return true;
      }
    }

    return Boolean(this.findPlacedObjectAt(worldX, worldY));
  }

  rebuildObjectSprites(): void {
    this.documentPresentation.rebuild({
      origin: this.getRoomOrigin(),
      placedObjects: this.host.getPlacedObjects(),
      spawnPoint: this.roomSpawnPoint,
      goal: this.roomGoal,
    });
    this.host.updateGoalUi();
    this.host.syncBackgroundCameraIgnores();
  }

  getPlacedObjectByInstanceId(instanceId: string | null | undefined): PlacedObject | null {
    if (!instanceId) {
      return null;
    }

    return this.host.getPlacedObjects().find((placed) => placed.instanceId === instanceId) ?? null;
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

    const placedObjects = this.host.getPlacedObjects();
    for (let index = placedObjects.length - 1; index >= 0; index -= 1) {
      const placed = placedObjects[index];
      if (filter && !filter(placed)) {
        continue;
      }

      const bounds = this.getPlacedObjectBounds(placed);
      const contains = Phaser.Geom.Rectangle.Contains(bounds, worldX, worldY);
      const worldPoint = this.toWorldPoint(placed.x, placed.y);
      const distance = Math.hypot(worldPoint.x - worldX, worldPoint.y - worldY);
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
    return this.getObjectLinkEligibleTargets(triggerInstanceId).filter((placed) =>
      canPlacedObjectBePressurePlateTarget(placed)
    );
  }

  getObjectLinkEligibleTargets(sourceInstanceId: string | null | undefined): PlacedObject[] {
    const source = this.getPlacedObjectByInstanceId(sourceInstanceId);
    if (!source || !canPlacedObjectUseObjectLink(source)) {
      return [];
    }

    return this.host.getPlacedObjects().filter(
      (placed) =>
        placed.instanceId !== sourceInstanceId &&
        canPlacedObjectBeLinkedObjectTarget(source, placed),
    );
  }

  setContainerContents(
    containerInstanceId: string,
    containedObjectId: string | null,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const containerIndex = placedObjects.findIndex(
      (placed) => placed.instanceId === containerInstanceId
    );
    if (containerIndex < 0) {
      return false;
    }

    const container = placedObjects[containerIndex];
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
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  setSignText(
    signInstanceId: string,
    signText: string | null,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const signIndex = placedObjects.findIndex((placed) => placed.instanceId === signInstanceId);
    if (signIndex < 0) {
      return false;
    }

    const sign = placedObjects[signIndex];
    if (!canPlacedObjectHaveSignText(sign)) {
      return false;
    }

    const normalizedText = normalizeSignText(signText);
    const previous = this.clonePlacedObjects();
    const previousText = normalizeSignText(previous[signIndex]?.signText);
    if (previousText === normalizedText) {
      return true;
    }

    const next = previous.map((placed, index) =>
      index === signIndex
        ? {
            ...placed,
            signText: normalizedText,
          }
        : placed
    );
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.markRoomDirty();
    return true;
  }

  setSwordsmanObjectiveMode(
    instanceId: string,
    objectiveMode: SwordsmanObjectiveMode,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const swordsmanIndex = placedObjects.findIndex((placed) => placed.instanceId === instanceId);
    if (swordsmanIndex < 0) {
      return false;
    }

    const swordsman = placedObjects[swordsmanIndex];
    if (swordsman.id !== SWORDSMAN_AI_OBJECT_ID) {
      return false;
    }

    const normalizedMode =
      normalizeSwordsmanObjectiveMode(objectiveMode) ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
    const previous = this.clonePlacedObjects();
    const previousMode =
      normalizeSwordsmanObjectiveMode(previous[swordsmanIndex]?.swordsmanObjectiveMode)
      ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
    if (previousMode === normalizedMode) {
      return true;
    }

    const next = previous.map((placed, index) =>
      index === swordsmanIndex
        ? {
            ...placed,
            swordsmanObjectiveMode: normalizedMode,
          }
        : placed
    );
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.markRoomDirty();
    return true;
  }

  setSwordsmanDefeatMode(
    instanceId: string,
    defeatMode: SwordsmanDefeatMode,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const swordsmanIndex = placedObjects.findIndex((placed) => placed.instanceId === instanceId);
    if (swordsmanIndex < 0) {
      return false;
    }

    const swordsman = placedObjects[swordsmanIndex];
    if (swordsman.id !== SWORDSMAN_AI_OBJECT_ID) {
      return false;
    }

    const normalizedMode =
      normalizeSwordsmanDefeatMode(defeatMode) ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
    const previous = this.clonePlacedObjects();
    const previousMode =
      normalizeSwordsmanDefeatMode(previous[swordsmanIndex]?.swordsmanDefeatMode)
      ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
    if (previousMode === normalizedMode) {
      return true;
    }

    const next = previous.map((placed, index) =>
      index === swordsmanIndex
        ? {
            ...placed,
            swordsmanDefeatMode: normalizedMode,
          }
        : placed
    );
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.markRoomDirty();
    return true;
  }

  setPoliceBehaviorMode(instanceId: string, mode: PoliceBehaviorMode): boolean {
    const normalizedMode = normalizePoliceBehaviorMode(mode) ?? DEFAULT_POLICE_BEHAVIOR_MODE;
    return this.updatePoliceEnemy(instanceId, (placed) => ({
      ...placed,
      policeBehaviorMode: normalizedMode,
    }));
  }

  setPolicePatrolShoots(instanceId: string, patrolShoots: boolean): boolean {
    return this.updatePoliceEnemy(instanceId, (placed) => ({
      ...placed,
      policePatrolShoots: Boolean(patrolShoots),
    }));
  }

  private updatePoliceEnemy(
    instanceId: string,
    update: (placed: PlacedObject) => PlacedObject,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const policeIndex = placedObjects.findIndex((placed) => placed.instanceId === instanceId);
    if (policeIndex < 0 || !isPoliceEnemyObjectId(placedObjects[policeIndex]?.id ?? '')) {
      return false;
    }

    const previous = this.clonePlacedObjects();
    const nextPolice = update(previous[policeIndex]);
    if (JSON.stringify(previous[policeIndex]) === JSON.stringify(nextPolice)) {
      return true;
    }

    const next = previous.map((placed, index) => index === policeIndex ? nextPolice : placed);
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  setNpcMode(instanceId: string, mode: NpcMode): boolean {
    const normalizedMode = normalizeNpcMode(mode) ?? DEFAULT_NPC_MODE;
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcMode: normalizedMode,
      npcPushable: normalizedMode === 'idle'
        ? ((normalizeNpcMode(placed.npcMode) ?? DEFAULT_NPC_MODE) === 'idle'
            ? Boolean(placed.npcPushable)
            : false)
        : true,
      npcCanJumpFall: normalizeNpcCanJumpFall(placed.npcCanJumpFall, normalizedMode),
    }));
  }

  setNpcPushable(instanceId: string, pushable: boolean): boolean {
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcPushable: Boolean(pushable),
    }));
  }

  setNpcCanJumpFall(instanceId: string, canJumpFall: boolean): boolean {
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcCanJumpFall: Boolean(canJumpFall),
    }));
  }

  setNpcPlayerCollision(instanceId: string, playerCollision: boolean): boolean {
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcPlayerCollision: Boolean(playerCollision),
    }));
  }

  setNpcFriendlyFire(instanceId: string, friendlyFire: boolean): boolean {
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcFriendlyFire: Boolean(friendlyFire),
    }));
  }

  setNpcName(instanceId: string, name: string): boolean {
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcName: normalizeNpcName(name),
    }));
  }

  setNpcDialogue(instanceId: string, text: string): boolean {
    return this.setSignText(instanceId, text);
  }

  setNpcDefeatMode(instanceId: string, defeatMode: SwordsmanDefeatMode): boolean {
    return this.updateNpc(instanceId, (placed) => ({
      ...placed,
      npcDefeatMode: normalizeNpcDefeatMode(defeatMode),
    }));
  }

  private updateNpc(
    instanceId: string,
    update: (placed: PlacedObject) => PlacedObject,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const npcIndex = placedObjects.findIndex((placed) => placed.instanceId === instanceId);
    if (npcIndex < 0 || !isNpcObjectId(placedObjects[npcIndex]?.id ?? '')) {
      return false;
    }

    const previous = this.clonePlacedObjects();
    const nextNpc = update(previous[npcIndex]);
    if (JSON.stringify(previous[npcIndex]) === JSON.stringify(nextNpc)) {
      return true;
    }

    const next = previous.map((placed, index) => index === npcIndex ? nextNpc : placed);
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  setPressurePlateTarget(
    triggerInstanceId: string,
    targetInstanceId: string | null,
  ): boolean {
    return this.setObjectLinkTarget(triggerInstanceId, targetInstanceId);
  }

  setObjectLinkTarget(
    sourceInstanceId: string,
    targetInstanceId: string | null,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const sourceIndex = placedObjects.findIndex(
      (placed) => placed.instanceId === sourceInstanceId
    );
    if (sourceIndex < 0) {
      return false;
    }

    const source = placedObjects[sourceIndex];
    if (!canPlacedObjectUseObjectLink(source)) {
      return false;
    }

    if (targetInstanceId) {
      const target = this.getPlacedObjectByInstanceId(targetInstanceId);
      if (
        !target ||
        target.instanceId === sourceInstanceId ||
        !canPlacedObjectBeLinkedObjectTarget(source, target)
      ) {
        return false;
      }
    }

    const previous = this.clonePlacedObjects();
    const previousPathTargetIds = getPlacedObjectPathTargetIds(previous[sourceIndex]);
    const nextPathTargetIds = targetInstanceId ? [targetInstanceId] : [];
    const next = previous.map((placed, index) =>
      index === sourceIndex
        ? canPlacedObjectUseObjectPath(placed)
          ? withPlacedObjectPathTargets(placed, nextPathTargetIds)
          : {
              ...placed,
              triggerTargetInstanceId: targetInstanceId,
              linkedTargetInstanceIds: null,
            }
        : placed
    );
    const previousTarget = previous[sourceIndex]?.triggerTargetInstanceId ?? null;
    if (
      previousTarget === targetInstanceId &&
      previousPathTargetIds.join('|') === nextPathTargetIds.join('|')
    ) {
      return true;
    }

    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  setObjectPathTargets(
    sourceInstanceId: string,
    targetInstanceIds: readonly string[],
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const sourceIndex = placedObjects.findIndex(
      (placed) => placed.instanceId === sourceInstanceId
    );
    if (sourceIndex < 0) {
      return false;
    }

    const source = placedObjects[sourceIndex];
    if (!canPlacedObjectUseObjectPath(source)) {
      return false;
    }

    const nextTargetIds: string[] = [];
    for (const targetInstanceId of targetInstanceIds) {
      const target = this.getPlacedObjectByInstanceId(targetInstanceId);
      if (
        target &&
        target.instanceId !== sourceInstanceId &&
        canPlacedObjectBeLinkedObjectTarget(source, target) &&
        !nextTargetIds.includes(target.instanceId)
      ) {
        nextTargetIds.push(target.instanceId);
      }
    }

    const previous = this.clonePlacedObjects();
    const previousTargetIds = getPlacedObjectPathTargetIds(previous[sourceIndex]);
    if (previousTargetIds.join('|') === nextTargetIds.join('|')) {
      return true;
    }

    const next = previous.map((placed, index) =>
      index === sourceIndex
        ? withPlacedObjectPathTargets(placed, nextTargetIds)
        : placed
    );
    this.host.setPlacedObjects(next);
    this.history.record({
      kind: 'objects',
      action: { previous, next: this.clonePlacedObjects(next) },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
    return true;
  }

  toggleObjectPathTarget(
    sourceInstanceId: string,
    targetInstanceId: string,
  ): 'added' | 'removed' | 'unchanged' {
    const source = this.getPlacedObjectByInstanceId(sourceInstanceId);
    if (!source || !canPlacedObjectUseObjectPath(source)) {
      return 'unchanged';
    }

    const currentTargetIds = getPlacedObjectPathTargetIds(source);
    const targetIndex = currentTargetIds.indexOf(targetInstanceId);
    const nextTargetIds =
      targetIndex >= 0
        ? currentTargetIds.filter((id) => id !== targetInstanceId)
        : [...currentTargetIds, targetInstanceId];
    if (!this.setObjectPathTargets(sourceInstanceId, nextTargetIds)) {
      return 'unchanged';
    }

    return targetIndex >= 0 ? 'removed' : 'added';
  }

  getObjectPathTargetIds(sourceInstanceId: string | null | undefined): string[] {
    return getPlacedObjectPathTargetIds(this.getPlacedObjectByInstanceId(sourceInstanceId));
  }

  getObjectPathTargets(sourceInstanceId: string | null | undefined): PlacedObject[] {
    return this.getObjectPathTargetIds(sourceInstanceId)
      .map((targetInstanceId) => this.getPlacedObjectByInstanceId(targetInstanceId))
      .filter((target): target is PlacedObject => Boolean(target));
  }

  private removeLinkedTargetFromPlacedObject(placed: PlacedObject, targetInstanceId: string | null | undefined): PlacedObject {
    if (!targetInstanceId) {
      return placed;
    }

    if (canPlacedObjectUseObjectPath(placed)) {
      const nextTargetIds = getPlacedObjectPathTargetIds(placed).filter(
        (candidateId) => candidateId !== targetInstanceId,
      );
      if (nextTargetIds.length !== getPlacedObjectPathTargetIds(placed).length) {
        return withPlacedObjectPathTargets(placed, nextTargetIds);
      }
    }

    return placed.triggerTargetInstanceId === targetInstanceId
      ? { ...placed, triggerTargetInstanceId: null, linkedTargetInstanceIds: null }
      : placed;
  }

  getPlacedObjectBounds(placed: PlacedObject): Phaser.Geom.Rectangle {
    const objectConfig = getEditorObjectConfigById(placed.id);
    if (!objectConfig) {
      const worldPoint = this.toWorldPoint(placed.x, placed.y);
      return new Phaser.Geom.Rectangle(worldPoint.x - 8, worldPoint.y - 8, 16, 16);
    }

    const displayScale = getObjectDisplayScale(objectConfig);
    const displayOffset = getObjectDisplayOffset(objectConfig);
    const width = Math.max(
      objectConfig.previewWidth ?? 0,
      objectConfig.bodyWidth ?? 0,
      objectConfig.frameWidth * displayScale
    );
    const height = Math.max(
      objectConfig.previewHeight ?? 0,
      objectConfig.bodyHeight ?? 0,
      objectConfig.frameHeight * displayScale
    );
    const x =
      placed.x -
      objectConfig.frameWidth * displayScale * 0.5 +
      displayOffset.x +
      (objectConfig.previewOffsetX ?? 0) * displayScale;
    const y =
      placed.y -
      objectConfig.frameHeight * displayScale * 0.5 +
      displayOffset.y +
      (objectConfig.previewOffsetY ?? 0) * displayScale;

    const origin = this.getRoomOrigin();
    return new Phaser.Geom.Rectangle(origin.x + x - 4, origin.y + y - 4, width + 8, height + 8);
  }

  getContainerContentsLabel(placed: PlacedObject | null | undefined): string | null {
    if (!placed || !canPlacedObjectBeContainer(placed) || !placed.containedObjectId) {
      return null;
    }

    return getObjectById(placed.containedObjectId)?.name ?? null;
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

    this.updateRoomGoal(withRoomGoalTimeLimitSeconds(this.roomGoal, seconds));
  }

  setGoalRequiredCount(requiredCount: number): void {
    if (!this.guardEditable()) {
      return;
    }
    if (
      !this.roomGoal ||
      (
        this.roomGoal.type !== 'collect_target' &&
        !(this.roomGoal.type === 'npc_quest' && this.roomGoal.questType === 'give')
      )
    ) {
      return;
    }

    this.updateRoomGoal(withRoomGoalRequiredCount(this.roomGoal, requiredCount));
  }

  setGoalSurvivalSeconds(seconds: number): void {
    if (!this.guardEditable()) {
      return;
    }
    if (
      !this.roomGoal ||
      (
        this.roomGoal.type !== 'survival' &&
        !(this.roomGoal.type === 'npc_quest' && this.roomGoal.questType === 'protect')
      )
    ) {
      return;
    }

    this.updateRoomGoal(withRoomGoalSurvivalSeconds(this.roomGoal, seconds));
  }

  setNpcQuestType(questType: 'protect' | 'escort' | 'give'): void {
    if (!this.guardEditable() || this.roomGoal?.type !== 'npc_quest') {
      return;
    }
    this.goalPlacementMode = null;
    this.updateRoomGoal(withNpcQuestType(this.roomGoal, questType));
  }

  setRoomCameraMode(centered: boolean): void {
    if (!this.guardEditable()) return;
    const mode = centered ? 'room' : 'follow';
    if (mode === this.roomCameraMode) return;
    this.roomCameraMode = mode;
    this.markRoomDirty();
    this.host.updateGoalUi();
  }

  setGoalIntroText(nextText: string | null): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!this.roomGoal) {
      return;
    }

    const normalizedNext = normalizeRoomGoalIntroText(nextText);
    if (normalizedNext === this.roomGoalIntroText) {
      this.host.updateGoalUi();
      return;
    }

    this.roomGoalIntroText = normalizedNext;
    this.markRoomDirty();
  }

  startGoalMarkerPlacement(mode: GoalPlacementMode): void {
    if (!this.guardEditable()) {
      return;
    }
    if (!roomGoalUsesMarkers(this.roomGoal)) {
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
    if (!roomGoalUsesMarkers(this.roomGoal)) {
      return;
    }

    this.goalPlacementMode = null;
    this.updateRoomGoal(clearRoomGoalMarkers(this.roomGoal!));
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
    if (this.roomGoal.type === 'npc_quest') {
      if (this.goalPlacementMode === 'npc') {
        const origin = this.getRoomOrigin();
        const worldX = origin.x + tileX * TILE_SIZE + TILE_SIZE / 2;
        const worldY = origin.y + tileY * TILE_SIZE + TILE_SIZE / 2;
        const linkedNpc = [...this.host.getPlacedObjects()]
          .reverse()
          .find((placed) => {
            const config = getEditorObjectConfigById(placed.id);
            return config?.category === 'npc' && this.getPlacedObjectBounds(placed).contains(worldX, worldY);
          });
        if (linkedNpc) {
          const mutation = placeRoomGoalMarker(
            this.roomGoal,
            this.goalPlacementMode,
            point,
            linkedNpc.instanceId,
          );
          if (mutation) {
            this.goalPlacementMode = mutation.placementComplete ? null : this.goalPlacementMode;
            this.updateRoomGoal(mutation.goal);
          }
        } else {
          this.host.updatePersistenceStatus('Click an NPC to link it to this goal.');
        }
        return;
      }
    }

    const mutation = placeRoomGoalMarker(this.roomGoal, this.goalPlacementMode, point);
    if (!mutation) {
      return;
    }
    this.goalPlacementMode = mutation.placementComplete ? null : this.goalPlacementMode;
    this.updateRoomGoal(mutation.goal);
  }

  removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    if (!this.guardEditable()) {
      return false;
    }
    const nextGoal = this.roomGoal
      ? removeRoomGoalMarkerAt(this.roomGoal, worldX, worldY)
      : null;
    if (nextGoal) {
      this.updateRoomGoal(nextGoal);
      return true;
    }

    return false;
  }

  goalUsesMarkers(goal: RoomGoal | null): boolean {
    return roomGoalUsesMarkers(goal);
  }

  getGoalSummaryText(): string {
    const linkedNpcInstanceId = this.roomGoal?.type === 'npc_quest'
      ? this.roomGoal.npcInstanceId
      : null;
    const linkedNpc = linkedNpcInstanceId
      ? this.host.getPlacedObjects().find((placed) => placed.instanceId === linkedNpcInstanceId)
      : this.host.getPlacedObjects().find(
          (placed) => getEditorObjectConfigById(placed.id)?.category === 'npc',
        );
    return getRoomGoalSummaryText(this.roomGoal, {
      collectiblesPlaced: this.countPlacedObjectsByCategory('collectible'),
      enemiesPlaced: this.countPlacedObjectsByCategory('enemy'),
      collectModeEnemyCount: this.countCollectModeSwordsmen(),
      linkedNpcLabel: linkedNpc
        ? getPlacedNpcName(linkedNpc, getEditorObjectConfigById(linkedNpc.id)?.name ?? 'NPC') || 'unnamed NPC'
        : 'no NPC',
    });
  }

  getPublishValidationError(): string | null {
    return getRoomGoalPublishValidationError(this.roomGoal, {
      collectiblesPlaced: this.countPlacedObjectsByCategory('collectible'),
      collectModeEnemyCount: this.countCollectModeSwordsmen(),
      npcInstanceIds: this.host.getPlacedObjects()
        .filter((placed) => getEditorObjectConfigById(placed.id)?.category === 'npc')
        .map((placed) => placed.instanceId),
    });
  }

  private countCollectModeSwordsmen(): number {
    return this.host.getPlacedObjects().filter(
      (placed) =>
        placed.id === SWORDSMAN_AI_OBJECT_ID &&
        (normalizeSwordsmanObjectiveMode(placed.swordsmanObjectiveMode)
          ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE) === 'collect',
    ).length;
  }

  hasUndoHistory(): boolean {
    return this.history.canUndo();
  }

  hasRedoHistory(): boolean {
    return this.history.canRedo();
  }

  undo(): void {
    if (!this.guardEditable()) {
      return;
    }
    const action = this.history.takeUndo();
    if (!action) {
      return;
    }
    recordReplayEditorAction('undo');

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
      if (action.smartBefore) {
        this.smartTerrain = cloneRoomSmartTerrainState(action.smartBefore);
      }
      this.history.pushRedo({
        kind: 'tiles', actions: reverseActions,
        smartBefore: action.smartAfter ? cloneRoomSmartTerrainState(action.smartAfter) : undefined,
        smartAfter: action.smartBefore ? cloneRoomSmartTerrainState(action.smartBefore) : undefined,
      });
      this.markRoomDirty();
      return;
    }

    if (action.kind === 'objects') {
      this.host.setPlacedObjects(this.clonePlacedObjects(action.action.previous));
      this.history.pushRedo({
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
      this.history.pushRedo({
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

    if (action.kind === 'music') {
      this.roomMusic = cloneRoomMusic(action.action.previous);
      this.history.pushRedo({
        kind: 'music',
        action: {
          previous: cloneRoomMusic(action.action.next),
          next: cloneRoomMusic(action.action.previous),
        },
      });
      this.markRoomDirty();
      return;
    }

    this.roomGoal = cloneRoomGoal(action.action.previous);
    this.goalPlacementMode = null;
    this.history.pushRedo({
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
    const action = this.history.takeRedo();
    if (!action) {
      return;
    }
    recordReplayEditorAction('redo');

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
      if (action.smartBefore) {
        this.smartTerrain = cloneRoomSmartTerrainState(action.smartBefore);
      }
      this.history.pushUndo({
        kind: 'tiles', actions: reverseActions,
        smartBefore: action.smartAfter ? cloneRoomSmartTerrainState(action.smartAfter) : undefined,
        smartAfter: action.smartBefore ? cloneRoomSmartTerrainState(action.smartBefore) : undefined,
      });
      this.markRoomDirty();
      return;
    }

    if (action.kind === 'objects') {
      this.host.setPlacedObjects(this.clonePlacedObjects(action.action.previous));
      this.history.pushUndo({
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
      this.history.pushUndo({
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

    if (action.kind === 'music') {
      this.roomMusic = cloneRoomMusic(action.action.previous);
      this.history.pushUndo({
        kind: 'music',
        action: {
          previous: cloneRoomMusic(action.action.next),
          next: cloneRoomMusic(action.action.previous),
        },
      });
      this.markRoomDirty();
      return;
    }

    this.roomGoal = cloneRoomGoal(action.action.previous);
    this.goalPlacementMode = null;
    this.history.pushUndo({
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
        : 'This room is read-only. Changes are local only.',
    );
  }

  private syncCustomRoomTileset(): void {
    const metadata = this.host.getRoomSnapshotMetadata();
    const textureKey = buildCustomRoomTileTextureKey(`editor:${metadata.roomId}`);
    ensureCustomRoomTileTexture(this.scene, textureKey, this.customRoomTiles);
    syncCustomRoomTilesetForLayers(this.host.getTilemap(), this.host.getLayers().values(), textureKey);
  }

  private roomMusicChanged(previous: RoomMusic | null, next: RoomMusic | null): boolean {
    return JSON.stringify(cloneRoomMusic(previous)) !== JSON.stringify(cloneRoomMusic(next));
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
    this.history.record({
      kind: 'spawn',
      action: { previous, next },
    });
    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  private updateRoomGoal(nextGoal: RoomGoal | null, trackUndo: boolean = true): void {
    const previous = cloneRoomGoal(this.roomGoal);
    const normalizedNext = cloneRoomGoal(nextGoal);

    if (JSON.stringify(previous) === JSON.stringify(normalizedNext)) {
      this.host.updateGoalUi();
      return;
    }

    this.roomGoal = normalizedNext;
    if (!this.roomGoal) {
      this.roomGoalIntroText = null;
    }
    if (!roomGoalUsesMarkers(this.roomGoal)) {
      this.goalPlacementMode = null;
    }

    if (trackUndo) {
      this.history.record({
        kind: 'goal',
        action: { previous, next: normalizedNext },
      });
    }

    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  private countPlacedObjectsByCategory(category: 'collectible' | 'enemy'): number {
    let count = 0;
    for (const placed of this.host.getPlacedObjects()) {
      if (placedObjectContributesToCategory(placed, category)) {
        count += 1;
      }
    }
    return count;
  }
}
