import {
  BACKGROUND_GROUPS,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  createPlacedObjectInstanceId,
  getObjectById,
  type LayerName,
  type PlacedObject,
} from '../../../config';
import {
  createGoalMarkerPointFromTile,
  normalizeRoomGoal,
  type GoalMarkerPoint,
  type RoomGoal,
} from '../../../goals/roomGoals';
import {
  cloneRoomSnapshot,
  createDefaultRoomSnapshot,
  normalizeRoomTitle,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import {
  HttpError,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  parseJsonBody,
} from '../core/http';
import type { Env } from '../core/types';
import { type RoomMutationActor, loadRoomRecordForMutation, saveDraft } from './store';
import { getAgentTilesetCatalogEntry, type AgentTilesetBuildStyle } from '../../../agentBuilder/tilesetCatalog';

export type RoomDraftCommandBase = 'current_draft' | 'published' | 'blank';

interface TilePoint {
  tileX: number;
  tileY: number;
}

interface SetTitleCommand {
  type: 'set_title';
  title: string | null;
}

interface SetBackgroundCommand {
  type: 'set_background';
  background: string;
}

interface SetSpawnCommand {
  type: 'set_spawn';
  tileX: number;
  tileY: number;
}

interface ReachExitGoalCommandValue {
  type: 'reach_exit';
  exit: TilePoint;
  timeLimitMs?: number | null;
}

interface CollectTargetGoalCommandValue {
  type: 'collect_target';
  requiredCount: number;
  timeLimitMs?: number | null;
}

interface DefeatAllGoalCommandValue {
  type: 'defeat_all';
  timeLimitMs?: number | null;
}

interface CheckpointSprintGoalCommandValue {
  type: 'checkpoint_sprint';
  checkpoints: TilePoint[];
  finish: TilePoint;
  timeLimitMs?: number | null;
}

interface SurvivalGoalCommandValue {
  type: 'survival';
  durationMs: number;
}

type GoalCommandValue =
  | ReachExitGoalCommandValue
  | CollectTargetGoalCommandValue
  | DefeatAllGoalCommandValue
  | CheckpointSprintGoalCommandValue
  | SurvivalGoalCommandValue;

interface SetGoalCommand {
  type: 'set_goal';
  goal: RoomGoal;
}

interface ClearGoalCommand {
  type: 'clear_goal';
}

interface PlatformCommand {
  type: 'platform';
  tilesetKey: string;
  styleId: string;
  row: number;
  colStart: number;
  colEnd: number;
  depth: number;
}

interface FillRectCommand {
  type: 'fill_rect';
  tilesetKey: string;
  styleId: string;
  role: 'surface' | 'fill';
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

interface EraseRectCommand {
  type: 'erase_rect';
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

interface ClearLayerCommand {
  type: 'clear_layer';
  layer: 'terrain';
}

interface PlaceObjectCommand {
  type: 'place_object';
  objectId: string;
  tileX: number;
  tileY: number;
  facing?: 'left' | 'right';
  layer?: LayerName;
}

interface RemoveObjectsInRectCommand {
  type: 'remove_objects_in_rect';
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

interface ClearObjectsCommand {
  type: 'clear_objects';
}

type RoomDraftCommand =
  | SetTitleCommand
  | SetBackgroundCommand
  | SetSpawnCommand
  | SetGoalCommand
  | ClearGoalCommand
  | PlatformCommand
  | FillRectCommand
  | EraseRectCommand
  | ClearLayerCommand
  | PlaceObjectCommand
  | RemoveObjectsInRectCommand
  | ClearObjectsCommand;

export interface RoomDraftCommandsRequestBody {
  base: RoomDraftCommandBase;
  commands: RoomDraftCommand[];
}

function normalizeBase(value: unknown): RoomDraftCommandBase {
  if (value === 'current_draft' || value === 'published' || value === 'blank') {
    return value;
  }

  throw new HttpError(400, 'base must be one of current_draft, published, or blank.');
}

function normalizeTileCoordinate(value: unknown, label: string, maxExclusive: number): number {
  const coordinate = normalizeNonNegativeInteger(value, label);
  if (coordinate >= maxExclusive) {
    throw new HttpError(400, `${label} must be less than ${maxExclusive}.`);
  }
  return coordinate;
}

function normalizeTilePoint(value: unknown, label: string): TilePoint {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, `${label} is required.`);
  }

  const point = value as Partial<TilePoint>;
  return {
    tileX: normalizeTileCoordinate(point.tileX, `${label}.tileX`, ROOM_WIDTH),
    tileY: normalizeTileCoordinate(point.tileY, `${label}.tileY`, ROOM_HEIGHT),
  };
}

function normalizeGoalMarkerPoint(point: TilePoint): GoalMarkerPoint {
  return createGoalMarkerPointFromTile(point.tileX, point.tileY);
}

function normalizeGoalCommandValue(value: unknown): RoomGoal {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'set_goal.goal is required.');
  }

  const goal = value as Partial<GoalCommandValue>;
  switch (goal.type) {
    case 'reach_exit': {
      const nextGoal = normalizeRoomGoal({
        type: 'reach_exit',
        exit: normalizeGoalMarkerPoint(normalizeTilePoint(goal.exit, 'set_goal.goal.exit')),
        timeLimitMs: goal.timeLimitMs ?? null,
      });
      if (!nextGoal || nextGoal.type !== 'reach_exit' || !nextGoal.exit) {
        throw new HttpError(400, 'reach_exit goal must include a valid exit marker.');
      }
      return nextGoal;
    }
    case 'collect_target': {
      const requiredCount = normalizePositiveInteger(goal.requiredCount, 'set_goal.goal.requiredCount');
      const nextGoal = normalizeRoomGoal({
        type: 'collect_target',
        requiredCount,
        timeLimitMs: goal.timeLimitMs ?? null,
      });
      if (!nextGoal || nextGoal.type !== 'collect_target') {
        throw new HttpError(400, 'collect_target goal is invalid.');
      }
      return nextGoal;
    }
    case 'defeat_all': {
      const nextGoal = normalizeRoomGoal({
        type: 'defeat_all',
        timeLimitMs: goal.timeLimitMs ?? null,
      });
      if (!nextGoal || nextGoal.type !== 'defeat_all') {
        throw new HttpError(400, 'defeat_all goal is invalid.');
      }
      return nextGoal;
    }
    case 'checkpoint_sprint': {
      if (!Array.isArray(goal.checkpoints) || goal.checkpoints.length === 0) {
        throw new HttpError(400, 'checkpoint_sprint goal requires at least one checkpoint.');
      }
      const checkpoints = goal.checkpoints.map((checkpoint, index) =>
        normalizeGoalMarkerPoint(normalizeTilePoint(checkpoint, `set_goal.goal.checkpoints[${index}]`))
      );
      const finish = normalizeGoalMarkerPoint(normalizeTilePoint(goal.finish, 'set_goal.goal.finish'));
      const nextGoal = normalizeRoomGoal({
        type: 'checkpoint_sprint',
        checkpoints,
        finish,
        timeLimitMs: goal.timeLimitMs ?? null,
      });
      if (!nextGoal || nextGoal.type !== 'checkpoint_sprint' || !nextGoal.finish || nextGoal.checkpoints.length === 0) {
        throw new HttpError(400, 'checkpoint_sprint goal is invalid.');
      }
      return nextGoal;
    }
    case 'survival': {
      const durationMs = normalizePositiveInteger(goal.durationMs, 'set_goal.goal.durationMs');
      const nextGoal = normalizeRoomGoal({
        type: 'survival',
        durationMs,
      });
      if (!nextGoal || nextGoal.type !== 'survival') {
        throw new HttpError(400, 'survival goal is invalid.');
      }
      return nextGoal;
    }
    default:
      throw new HttpError(400, 'set_goal.goal.type is invalid.');
  }
}

function normalizeLayer(value: unknown, label: string): LayerName | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === 'background' || value === 'terrain' || value === 'foreground') {
    return value;
  }

  throw new HttpError(400, `${label} must be background, terrain, or foreground.`);
}

function getBuildStyleOrThrow(tilesetKey: string, styleId: string): AgentTilesetBuildStyle {
  const entry = getAgentTilesetCatalogEntry(tilesetKey);
  if (!entry) {
    throw new HttpError(400, `Unknown tilesetKey "${tilesetKey}".`);
  }

  const style = entry.buildStyles.find((candidate) => candidate.id === styleId);
  if (!style) {
    throw new HttpError(400, `Unknown styleId "${styleId}" for tileset "${tilesetKey}".`);
  }

  return style;
}

function normalizeCommand(value: unknown, index: number): RoomDraftCommand {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, `commands[${index}] must be an object.`);
  }

  const command = value as Partial<RoomDraftCommand>;
  switch (command.type) {
    case 'set_title':
      return {
        type: 'set_title',
        title: normalizeRoomTitle(command.title) ?? null,
      };
    case 'set_background': {
      if (typeof command.background !== 'string') {
        throw new HttpError(400, `commands[${index}].background must be a string.`);
      }
      if (!BACKGROUND_GROUPS.some((group) => group.id === command.background)) {
        throw new HttpError(400, `Unknown background "${command.background}".`);
      }
      return {
        type: 'set_background',
        background: command.background,
      };
    }
    case 'set_spawn':
      return {
        type: 'set_spawn',
        tileX: normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH),
        tileY: normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT),
      };
    case 'set_goal':
      return {
        type: 'set_goal',
        goal: normalizeGoalCommandValue(command.goal),
      };
    case 'clear_goal':
      return { type: 'clear_goal' };
    case 'platform': {
      if (typeof command.tilesetKey !== 'string' || typeof command.styleId !== 'string') {
        throw new HttpError(400, `commands[${index}] requires tilesetKey and styleId.`);
      }
      getBuildStyleOrThrow(command.tilesetKey, command.styleId);
      const row = normalizeTileCoordinate(command.row, `commands[${index}].row`, ROOM_HEIGHT);
      const colStart = normalizeTileCoordinate(command.colStart, `commands[${index}].colStart`, ROOM_WIDTH);
      const colEnd = normalizeTileCoordinate(command.colEnd, `commands[${index}].colEnd`, ROOM_WIDTH);
      if (colEnd < colStart) {
        throw new HttpError(400, `commands[${index}].colEnd must be greater than or equal to colStart.`);
      }
      const depth = normalizePositiveInteger(command.depth, `commands[${index}].depth`);
      if (row + depth > ROOM_HEIGHT) {
        throw new HttpError(400, `commands[${index}] platform exceeds room height.`);
      }
      return {
        type: 'platform',
        tilesetKey: command.tilesetKey,
        styleId: command.styleId,
        row,
        colStart,
        colEnd,
        depth,
      };
    }
    case 'fill_rect': {
      if (typeof command.tilesetKey !== 'string' || typeof command.styleId !== 'string') {
        throw new HttpError(400, `commands[${index}] requires tilesetKey and styleId.`);
      }
      if (command.role !== 'surface' && command.role !== 'fill') {
        throw new HttpError(400, `commands[${index}].role must be surface or fill.`);
      }
      getBuildStyleOrThrow(command.tilesetKey, command.styleId);
      const tileX = normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH);
      const tileY = normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT);
      const width = normalizePositiveInteger(command.width, `commands[${index}].width`);
      const height = normalizePositiveInteger(command.height, `commands[${index}].height`);
      if (tileX + width > ROOM_WIDTH || tileY + height > ROOM_HEIGHT) {
        throw new HttpError(400, `commands[${index}] fill_rect exceeds room bounds.`);
      }
      return {
        type: 'fill_rect',
        tilesetKey: command.tilesetKey,
        styleId: command.styleId,
        role: command.role,
        tileX,
        tileY,
        width,
        height,
      };
    }
    case 'erase_rect': {
      const tileX = normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH);
      const tileY = normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT);
      const width = normalizePositiveInteger(command.width, `commands[${index}].width`);
      const height = normalizePositiveInteger(command.height, `commands[${index}].height`);
      if (tileX + width > ROOM_WIDTH || tileY + height > ROOM_HEIGHT) {
        throw new HttpError(400, `commands[${index}] erase_rect exceeds room bounds.`);
      }
      return {
        type: 'erase_rect',
        tileX,
        tileY,
        width,
        height,
      };
    }
    case 'clear_layer':
      if (command.layer !== 'terrain') {
        throw new HttpError(400, `commands[${index}].layer must be terrain.`);
      }
      return {
        type: 'clear_layer',
        layer: 'terrain',
      };
    case 'place_object': {
      if (typeof command.objectId !== 'string') {
        throw new HttpError(400, `commands[${index}].objectId must be a string.`);
      }
      const objectConfig = getObjectById(command.objectId);
      if (!objectConfig) {
        throw new HttpError(400, `Unknown objectId "${command.objectId}".`);
      }
      if (command.objectId === 'spawn_point') {
        throw new HttpError(400, 'Use set_spawn instead of place_object for spawn points.');
      }
      if (command.facing !== undefined && command.facing !== 'left' && command.facing !== 'right') {
        throw new HttpError(400, `commands[${index}].facing must be left or right.`);
      }
      return {
        type: 'place_object',
        objectId: command.objectId,
        tileX: normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH),
        tileY: normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT),
        facing: command.facing,
        layer: normalizeLayer(command.layer, `commands[${index}].layer`),
      };
    }
    case 'remove_objects_in_rect': {
      const tileX = normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH);
      const tileY = normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT);
      const width = normalizePositiveInteger(command.width, `commands[${index}].width`);
      const height = normalizePositiveInteger(command.height, `commands[${index}].height`);
      if (tileX + width > ROOM_WIDTH || tileY + height > ROOM_HEIGHT) {
        throw new HttpError(400, `commands[${index}] remove_objects_in_rect exceeds room bounds.`);
      }
      return {
        type: 'remove_objects_in_rect',
        tileX,
        tileY,
        width,
        height,
      };
    }
    case 'clear_objects':
      return { type: 'clear_objects' };
    default:
      throw new HttpError(400, `commands[${index}].type is invalid.`);
  }
}

function normalizeCommands(value: unknown): RoomDraftCommand[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'commands must be a non-empty array.');
  }

  return value.map((command, index) => normalizeCommand(command, index));
}

export async function parseRoomDraftCommandsRequest(request: Request): Promise<RoomDraftCommandsRequestBody> {
  const body = await parseJsonBody<RoomDraftCommandsRequestBody>(request);
  return {
    base: normalizeBase(body.base),
    commands: normalizeCommands(body.commands),
  };
}

function pickPlatformTile(localIndices: number[], index: number, width: number): number {
  if (localIndices.length === 0) {
    throw new HttpError(500, 'Build style is missing tile indices.');
  }

  if (width <= 1) {
    return localIndices[Math.floor(localIndices.length / 2)] ?? localIndices[0];
  }

  if (index === 0) {
    return localIndices[0];
  }

  if (index === width - 1) {
    return localIndices[localIndices.length - 1];
  }

  const middleIndices = localIndices.slice(1, -1);
  if (middleIndices.length === 0) {
    return localIndices[Math.min(1, localIndices.length - 1)] ?? localIndices[0];
  }

  return middleIndices[(index - 1) % middleIndices.length] ?? middleIndices[0];
}

function applyPlatformCommand(room: RoomSnapshot, command: PlatformCommand): void {
  const style = getBuildStyleOrThrow(command.tilesetKey, command.styleId);
  const width = command.colEnd - command.colStart + 1;
  for (let xOffset = 0; xOffset < width; xOffset += 1) {
    const tileX = command.colStart + xOffset;
    room.tileData.terrain[command.row][tileX] =
      pickPlatformTile(style.surfaceGids, xOffset, width);
    for (let yOffset = 1; yOffset < command.depth; yOffset += 1) {
      room.tileData.terrain[command.row + yOffset][tileX] =
        pickPlatformTile(style.fillGids, xOffset, width);
    }
  }
}

function applyFillRectCommand(room: RoomSnapshot, command: FillRectCommand): void {
  const style = getBuildStyleOrThrow(command.tilesetKey, command.styleId);
  const gids = command.role === 'surface' ? style.surfaceGids : style.fillGids;
  for (let yOffset = 0; yOffset < command.height; yOffset += 1) {
    for (let xOffset = 0; xOffset < command.width; xOffset += 1) {
      const tileX = command.tileX + xOffset;
      const tileY = command.tileY + yOffset;
      room.tileData.terrain[tileY][tileX] = pickPlatformTile(gids, xOffset, command.width);
    }
  }
}

function applyEraseRectCommand(room: RoomSnapshot, command: EraseRectCommand): void {
  for (let yOffset = 0; yOffset < command.height; yOffset += 1) {
    for (let xOffset = 0; xOffset < command.width; xOffset += 1) {
      room.tileData.terrain[command.tileY + yOffset][command.tileX + xOffset] = -1;
    }
  }
}

function clearTerrainLayer(room: RoomSnapshot): void {
  for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
    for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
      room.tileData.terrain[tileY][tileX] = -1;
    }
  }
}

function placeObjectAtTile(command: PlaceObjectCommand): PlacedObject {
  const objectConfig = getObjectById(command.objectId);
  if (!objectConfig) {
    throw new HttpError(400, `Unknown objectId "${command.objectId}".`);
  }

  return {
    id: command.objectId,
    x: command.tileX * TILE_SIZE + objectConfig.frameWidth / 2,
    y: command.tileY * TILE_SIZE + TILE_SIZE - objectConfig.frameHeight / 2,
    instanceId: createPlacedObjectInstanceId(),
    facing: objectConfig.facingDirection ? command.facing : undefined,
    layer: command.layer,
    triggerTargetInstanceId: null,
    containedObjectId: null,
  };
}

function applyObjectRectRemoval(room: RoomSnapshot, command: RemoveObjectsInRectCommand): void {
  const minX = command.tileX * TILE_SIZE;
  const minY = command.tileY * TILE_SIZE;
  const maxX = minX + command.width * TILE_SIZE;
  const maxY = minY + command.height * TILE_SIZE;
  room.placedObjects = room.placedObjects.filter((placedObject) =>
    !(
      placedObject.x >= minX &&
      placedObject.x < maxX &&
      placedObject.y >= minY &&
      placedObject.y < maxY
    )
  );
}

function applyCommand(room: RoomSnapshot, command: RoomDraftCommand): void {
  switch (command.type) {
    case 'set_title':
      room.title = command.title;
      return;
    case 'set_background':
      room.background = command.background;
      return;
    case 'set_spawn':
      room.spawnPoint = normalizeGoalMarkerPoint({ tileX: command.tileX, tileY: command.tileY });
      return;
    case 'set_goal':
      room.goal = normalizeRoomGoal(command.goal);
      return;
    case 'clear_goal':
      room.goal = null;
      return;
    case 'platform':
      applyPlatformCommand(room, command);
      return;
    case 'fill_rect':
      applyFillRectCommand(room, command);
      return;
    case 'erase_rect':
      applyEraseRectCommand(room, command);
      return;
    case 'clear_layer':
      clearTerrainLayer(room);
      return;
    case 'place_object':
      room.placedObjects.push(placeObjectAtTile(command));
      return;
    case 'remove_objects_in_rect':
      applyObjectRectRemoval(room, command);
      return;
    case 'clear_objects':
      room.placedObjects = [];
      return;
  }
}

function selectBaseSnapshot(
  roomId: string,
  coordinates: RoomCoordinates,
  record: RoomRecord,
  base: RoomDraftCommandBase,
): RoomSnapshot {
  switch (base) {
    case 'current_draft':
      return cloneRoomSnapshot(record.draft);
    case 'published':
      if (!record.published) {
        throw new HttpError(409, 'Cannot use base=published because this room has no published version.');
      }
      return cloneRoomSnapshot(record.published);
    case 'blank':
      return createDefaultRoomSnapshot(roomId, coordinates);
  }
}

export async function saveDraftFromCommandRequest(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  requestBody: RoomDraftCommandsRequestBody,
  actor: RoomMutationActor,
  actorIsAdmin = false,
): Promise<RoomRecord> {
  const existing = await loadRoomRecordForMutation(env, roomId, coordinates, actor.ownerUser, actorIsAdmin);
  if (!existing.permissions.canSaveDraft) {
    throw new HttpError(403, 'Only the room token owner can save drafts for this minted room.');
  }

  const nextDraft = selectBaseSnapshot(roomId, coordinates, existing, requestBody.base);
  nextDraft.id = roomId;
  nextDraft.coordinates = { ...coordinates };

  for (const command of requestBody.commands) {
    applyCommand(nextDraft, command);
  }

  return saveDraft(env, nextDraft, actor, actorIsAdmin);
}
