import {
  BACKGROUND_GROUPS,
  LAYER_NAMES,
  MOVING_PLATFORM_OBJECT_ID,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBeLinkedObjectTarget,
  canPlacedObjectUseObjectLink,
  createPlacedObjectInstanceId,
  encodeTileDataValue,
  getObjectById,
  getObjectPlacementPointForTile,
  getTilesetByKey,
  isTilesetLocalTileEditorEnabled,
  type LayerName,
  type PlacedObject,
} from '../../../config';
import {
  isCustomBackgroundValue,
  isSolidColorBackgroundValue,
  normalizeRoomBackground,
} from '../../../backgrounds/model';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
  normalizeSwordsmanDefeatMode,
  normalizeSwordsmanObjectiveMode,
  type SwordsmanDefeatMode,
  type SwordsmanObjectiveMode,
} from '../../../enemies/swordsmanObjectives';
import {
  createGoalMarkerPointFromTile,
  normalizeRoomGoal,
  type GoalMarkerPoint,
  type NpcQuestType,
  type RoomGoal,
} from '../../../goals/roomGoals';
import {
  DEFAULT_NPC_MODE,
  NPC_NAME_MAX_LENGTH,
  getPlacedNpcDefeatMode,
  isNpcObjectId,
  normalizeNpcCanJumpFall,
  normalizeNpcDefeatMode,
  normalizeNpcFriendlyFire,
  normalizeNpcMode,
  normalizeNpcName,
  normalizeNpcPlayerCollision,
  normalizeNpcPushable,
  type NpcMode,
} from '../../../npcs/model';
import { MAX_PLACED_OBJECT_PATH_TARGETS } from '../../../placedObjects/objectPaths';
import {
  SIGN_TEXT_MAX_LENGTH,
  canPlacedObjectHaveSignText,
  normalizeSignText,
} from '../../../signs/model';
import {
  cloneRoomSnapshot,
  normalizeRoomTitle,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import {
  getAgentTilesetCatalogEntry,
  type AgentTilesetBuildStyle,
} from '../../../agentBuilder/tilesetCatalog';
import {
  HttpError,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
} from '../core/http';

export const MAX_ROOM_DRAFT_COMMAND_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_ROOM_DRAFT_COMMANDS = 512;
export const MAX_SET_TILES_PER_COMMAND = ROOM_WIDTH * ROOM_HEIGHT;
export const MAX_ROOM_DRAFT_TILE_WRITES = ROOM_WIDTH * ROOM_HEIGHT * LAYER_NAMES.length;
export const MAX_ROOM_DRAFT_COMMAND_REF_LENGTH = 64;

export const ROOM_DRAFT_COMMAND_TYPES = [
  'set_title',
  'set_background',
  'set_spawn',
  'set_goal',
  'clear_goal',
  'platform',
  'fill_rect',
  'set_tiles',
  'erase_rect',
  'clear_layer',
  'place_object',
  'configure_object',
  'remove_object',
  'remove_objects_in_rect',
  'clear_objects',
] as const;

export type RoomDraftCommandBase = 'current_draft' | 'published' | 'blank';

interface TilePoint {
  tileX: number;
  tileY: number;
}

export interface ObjectSelector {
  ref?: string;
  instanceId?: string;
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

interface NpcQuestGoalCommandValue {
  type: 'npc_quest';
  questType: NpcQuestType;
  npc: ObjectSelector;
  durationMs: number;
  requiredCount: number;
  destination: GoalMarkerPoint | null;
}

interface SetGoalCommand {
  type: 'set_goal';
  goal: RoomGoal | NpcQuestGoalCommandValue;
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

interface SetTileValue {
  tileX: number;
  tileY: number;
  localIndex: number;
  flipX: boolean;
  flipY: boolean;
}

interface SetTilesCommand {
  type: 'set_tiles';
  tilesetKey: string;
  layer: LayerName;
  tiles: SetTileValue[];
}

interface EraseRectCommand {
  type: 'erase_rect';
  layer: LayerName;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

interface ClearLayerCommand {
  type: 'clear_layer';
  layer: LayerName;
}

interface PlaceObjectCommand {
  type: 'place_object';
  ref?: string;
  objectId: string;
  tileX: number;
  tileY: number;
  facing?: 'left' | 'right';
  layer?: LayerName;
  swordsmanObjectiveMode?: SwordsmanObjectiveMode;
  swordsmanDefeatMode?: SwordsmanDefeatMode;
}

interface ObjectConfiguration {
  layer?: LayerName | null;
  facing?: 'left' | 'right' | null;
  linkedTargets?: ObjectSelector[];
  containedObjectId?: string | null;
  signText?: string | null;
  swordsmanObjectiveMode?: SwordsmanObjectiveMode | null;
  swordsmanDefeatMode?: SwordsmanDefeatMode | null;
  npcMode?: NpcMode | null;
  npcPushable?: boolean | null;
  npcCanJumpFall?: boolean | null;
  npcPlayerCollision?: boolean | null;
  npcFriendlyFire?: boolean | null;
  npcName?: string | null;
  npcDefeatMode?: SwordsmanDefeatMode | null;
}

interface ConfigureObjectCommand extends ObjectConfiguration {
  type: 'configure_object';
  target: ObjectSelector;
}

interface RemoveObjectCommand {
  type: 'remove_object';
  target: ObjectSelector;
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

export type RoomDraftCommand =
  | SetTitleCommand
  | SetBackgroundCommand
  | SetSpawnCommand
  | SetGoalCommand
  | ClearGoalCommand
  | PlatformCommand
  | FillRectCommand
  | SetTilesCommand
  | EraseRectCommand
  | ClearLayerCommand
  | PlaceObjectCommand
  | ConfigureObjectCommand
  | RemoveObjectCommand
  | RemoveObjectsInRectCommand
  | ClearObjectsCommand;

export interface RoomDraftCommandsRequestBody {
  base: RoomDraftCommandBase;
  commands: RoomDraftCommand[];
}

export interface ApplyRoomDraftCommandsResult {
  snapshot: RoomSnapshot;
  commandRefs: Record<string, string>;
}

interface NormalizationState {
  refs: Set<string>;
  tileWrites: number;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    throw new HttpError(400, `${label} has unsupported field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}.`);
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeBase(value: unknown): RoomDraftCommandBase {
  if (value === 'current_draft' || value === 'published' || value === 'blank') return value;
  throw new HttpError(400, 'base must be one of current_draft, published, or blank.');
}

function normalizeTileCoordinate(value: unknown, label: string, maxExclusive: number): number {
  const coordinate = normalizeNonNegativeInteger(value, label);
  if (coordinate >= maxExclusive) throw new HttpError(400, `${label} must be less than ${maxExclusive}.`);
  return coordinate;
}

function normalizeTilePoint(value: unknown, label: string): TilePoint {
  const point = asRecord(value, label);
  assertAllowedKeys(point, ['tileX', 'tileY'], label);
  return {
    tileX: normalizeTileCoordinate(point.tileX, `${label}.tileX`, ROOM_WIDTH),
    tileY: normalizeTileCoordinate(point.tileY, `${label}.tileY`, ROOM_HEIGHT),
  };
}

function normalizeGoalMarkerPoint(value: unknown, label: string): GoalMarkerPoint {
  const point = normalizeTilePoint(value, label);
  return createGoalMarkerPointFromTile(point.tileX, point.tileY);
}

function normalizeOptionalPositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return normalizePositiveInteger(value, label);
}

function normalizeLayer(value: unknown, label: string): LayerName {
  if ((LAYER_NAMES as readonly unknown[]).includes(value)) return value as LayerName;
  throw new HttpError(400, `${label} must be background, terrain, or foreground.`);
}

function normalizeOptionalLayer(value: unknown, label: string): LayerName | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeLayer(value, label);
}

function normalizeRef(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string.`);
  const ref = value.trim();
  if (!ref) throw new HttpError(400, `${label} must not be empty.`);
  if (ref.length > MAX_ROOM_DRAFT_COMMAND_REF_LENGTH) {
    throw new HttpError(400, `${label} must be at most ${MAX_ROOM_DRAFT_COMMAND_REF_LENGTH} characters.`);
  }
  return ref;
}

function normalizeInstanceId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string.`);
  const instanceId = value.trim();
  if (!instanceId) throw new HttpError(400, `${label} must not be empty.`);
  if (instanceId.length > 160) throw new HttpError(400, `${label} must be at most 160 characters.`);
  return instanceId;
}

function normalizeSelector(value: unknown, label: string, availableRefs: Set<string>): ObjectSelector {
  const selector = asRecord(value, label);
  assertAllowedKeys(selector, ['ref', 'instanceId'], label);
  const hasRef = hasOwn(selector, 'ref');
  const hasInstanceId = hasOwn(selector, 'instanceId');
  if (hasRef === hasInstanceId) {
    throw new HttpError(400, `${label} must contain exactly one of ref or instanceId.`);
  }
  if (hasRef) {
    const ref = normalizeRef(selector.ref, `${label}.ref`);
    if (!availableRefs.has(ref)) throw new HttpError(400, `${label}.ref "${ref}" must refer to an earlier place_object command.`);
    return { ref };
  }
  return { instanceId: normalizeInstanceId(selector.instanceId, `${label}.instanceId`) };
}

function normalizeGoalCommandValue(value: unknown, availableRefs: Set<string>): RoomGoal | NpcQuestGoalCommandValue {
  const goal = asRecord(value, 'set_goal.goal');
  switch (goal.type) {
    case 'reach_exit': {
      assertAllowedKeys(goal, ['type', 'exit', 'timeLimitMs'], 'set_goal.goal');
      const nextGoal = normalizeRoomGoal({
        type: 'reach_exit',
        exit: normalizeGoalMarkerPoint(goal.exit, 'set_goal.goal.exit'),
        timeLimitMs: normalizeOptionalPositiveInteger(goal.timeLimitMs, 'set_goal.goal.timeLimitMs'),
      });
      if (!nextGoal || nextGoal.type !== 'reach_exit' || !nextGoal.exit) throw new HttpError(400, 'reach_exit goal is invalid.');
      return nextGoal;
    }
    case 'collect_target': {
      assertAllowedKeys(goal, ['type', 'requiredCount', 'timeLimitMs'], 'set_goal.goal');
      const nextGoal = normalizeRoomGoal({
        type: 'collect_target',
        requiredCount: normalizePositiveInteger(goal.requiredCount, 'set_goal.goal.requiredCount'),
        timeLimitMs: normalizeOptionalPositiveInteger(goal.timeLimitMs, 'set_goal.goal.timeLimitMs'),
      });
      if (!nextGoal || nextGoal.type !== 'collect_target') throw new HttpError(400, 'collect_target goal is invalid.');
      return nextGoal;
    }
    case 'collect_race': {
      assertAllowedKeys(goal, ['type', 'timeLimitMs'], 'set_goal.goal');
      const nextGoal = normalizeRoomGoal({
        type: 'collect_race',
        timeLimitMs: normalizeOptionalPositiveInteger(goal.timeLimitMs, 'set_goal.goal.timeLimitMs'),
      });
      if (!nextGoal || nextGoal.type !== 'collect_race') throw new HttpError(400, 'collect_race goal is invalid.');
      return nextGoal;
    }
    case 'defeat_all': {
      assertAllowedKeys(goal, ['type', 'timeLimitMs'], 'set_goal.goal');
      const nextGoal = normalizeRoomGoal({
        type: 'defeat_all',
        timeLimitMs: normalizeOptionalPositiveInteger(goal.timeLimitMs, 'set_goal.goal.timeLimitMs'),
      });
      if (!nextGoal || nextGoal.type !== 'defeat_all') throw new HttpError(400, 'defeat_all goal is invalid.');
      return nextGoal;
    }
    case 'checkpoint_sprint': {
      assertAllowedKeys(goal, ['type', 'checkpoints', 'finish', 'timeLimitMs'], 'set_goal.goal');
      if (!Array.isArray(goal.checkpoints) || goal.checkpoints.length === 0) {
        throw new HttpError(400, 'checkpoint_sprint goal requires at least one checkpoint.');
      }
      const checkpoints = goal.checkpoints.map((point, index) =>
        normalizeGoalMarkerPoint(point, `set_goal.goal.checkpoints[${index}]`));
      const nextGoal = normalizeRoomGoal({
        type: 'checkpoint_sprint',
        checkpoints,
        finish: normalizeGoalMarkerPoint(goal.finish, 'set_goal.goal.finish'),
        timeLimitMs: normalizeOptionalPositiveInteger(goal.timeLimitMs, 'set_goal.goal.timeLimitMs'),
      });
      if (!nextGoal || nextGoal.type !== 'checkpoint_sprint' || !nextGoal.finish) throw new HttpError(400, 'checkpoint_sprint goal is invalid.');
      return nextGoal;
    }
    case 'survival': {
      assertAllowedKeys(goal, ['type', 'durationMs'], 'set_goal.goal');
      const nextGoal = normalizeRoomGoal({
        type: 'survival',
        durationMs: normalizePositiveInteger(goal.durationMs, 'set_goal.goal.durationMs'),
      });
      if (!nextGoal || nextGoal.type !== 'survival') throw new HttpError(400, 'survival goal is invalid.');
      return nextGoal;
    }
    case 'npc_quest': {
      if (goal.questType !== 'protect' && goal.questType !== 'escort' && goal.questType !== 'give') {
        throw new HttpError(400, 'set_goal.goal.questType must be protect, escort, or give.');
      }
      const commonKeys = ['type', 'questType', 'npc', 'npcInstanceId'];
      const allowedKeys = goal.questType === 'protect'
        ? [...commonKeys, 'durationMs']
        : goal.questType === 'escort'
          ? [...commonKeys, 'destination']
          : [...commonKeys, 'requiredCount'];
      assertAllowedKeys(goal, allowedKeys, 'set_goal.goal');
      const hasNpc = hasOwn(goal, 'npc');
      const hasNpcInstanceId = hasOwn(goal, 'npcInstanceId');
      if (hasNpc === hasNpcInstanceId) {
        throw new HttpError(400, 'npc_quest requires exactly one of npc or npcInstanceId.');
      }
      const npc = hasNpc
        ? normalizeSelector(goal.npc, 'set_goal.goal.npc', availableRefs)
        : { instanceId: normalizeInstanceId(goal.npcInstanceId, 'set_goal.goal.npcInstanceId') };
      return {
        type: 'npc_quest',
        questType: goal.questType,
        npc,
        durationMs: goal.questType === 'protect'
          ? normalizeOptionalPositiveInteger(goal.durationMs, 'set_goal.goal.durationMs') ?? 30_000
          : 30_000,
        requiredCount: goal.questType === 'give'
          ? normalizePositiveInteger(goal.requiredCount, 'set_goal.goal.requiredCount')
          : 1,
        destination: goal.questType === 'escort'
          ? normalizeGoalMarkerPoint(goal.destination, 'set_goal.goal.destination')
          : null,
      };
    }
    default:
      throw new HttpError(400, 'set_goal.goal.type is invalid.');
  }
}

function getBuildStyleOrThrow(tilesetKey: string, styleId: string): AgentTilesetBuildStyle {
  const entry = getAgentTilesetCatalogEntry(tilesetKey);
  if (!entry) throw new HttpError(400, `Unknown tilesetKey "${tilesetKey}".`);
  const normalizedStyleId = entry.key === 'cave' && styleId === 'dirt_flat' ? 'cave_flat' : styleId;
  const style = entry.buildStyles.find((candidate) => candidate.id === normalizedStyleId);
  if (!style) throw new HttpError(400, `Unknown styleId "${styleId}" for tileset "${tilesetKey}".`);
  return style;
}

function normalizeRect(command: Record<string, unknown>, index: number): { tileX: number; tileY: number; width: number; height: number } {
  const tileX = normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH);
  const tileY = normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT);
  const width = normalizePositiveInteger(command.width, `commands[${index}].width`);
  const height = normalizePositiveInteger(command.height, `commands[${index}].height`);
  if (tileX + width > ROOM_WIDTH || tileY + height > ROOM_HEIGHT) {
    throw new HttpError(400, `commands[${index}] rectangle exceeds room bounds.`);
  }
  return { tileX, tileY, width, height };
}

function addTileWrites(state: NormalizationState, count: number): void {
  state.tileWrites += count;
  if (state.tileWrites > MAX_ROOM_DRAFT_TILE_WRITES) {
    throw new HttpError(400, `Command list exceeds the ${MAX_ROOM_DRAFT_TILE_WRITES} cumulative tile-write limit.`);
  }
}

function normalizeNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be a boolean or null.`);
  return value;
}

function normalizeConfiguration(command: Record<string, unknown>, index: number, state: NormalizationState): ObjectConfiguration {
  const configuration: ObjectConfiguration = {};
  if (hasOwn(command, 'layer')) configuration.layer = command.layer === null ? null : normalizeLayer(command.layer, `commands[${index}].layer`);
  if (hasOwn(command, 'facing')) {
    if (command.facing !== null && command.facing !== 'left' && command.facing !== 'right') {
      throw new HttpError(400, `commands[${index}].facing must be left, right, or null.`);
    }
    configuration.facing = command.facing;
  }
  if (hasOwn(command, 'linkedTargets')) {
    if (command.linkedTargets !== null && !Array.isArray(command.linkedTargets)) {
      throw new HttpError(400, `commands[${index}].linkedTargets must be an array or null.`);
    }
    const targets = command.linkedTargets ?? [];
    if (targets.length > MAX_PLACED_OBJECT_PATH_TARGETS) {
      throw new HttpError(400, `commands[${index}].linkedTargets allows at most ${MAX_PLACED_OBJECT_PATH_TARGETS} targets.`);
    }
    configuration.linkedTargets = targets.map((target, targetIndex) =>
      normalizeSelector(target, `commands[${index}].linkedTargets[${targetIndex}]`, state.refs));
  }
  if (hasOwn(command, 'containedObjectId')) {
    if (command.containedObjectId !== null && typeof command.containedObjectId !== 'string') {
      throw new HttpError(400, `commands[${index}].containedObjectId must be a string or null.`);
    }
    const containedObjectId = typeof command.containedObjectId === 'string' ? command.containedObjectId.trim() : null;
    if (command.containedObjectId !== null && !containedObjectId) throw new HttpError(400, `commands[${index}].containedObjectId must not be empty.`);
    configuration.containedObjectId = containedObjectId;
  }
  if (hasOwn(command, 'signText')) {
    if (command.signText !== null && typeof command.signText !== 'string') throw new HttpError(400, `commands[${index}].signText must be a string or null.`);
    if (typeof command.signText === 'string' && command.signText.replace(/\r\n?/g, '\n').trim().length > SIGN_TEXT_MAX_LENGTH) {
      throw new HttpError(400, `commands[${index}].signText must be at most ${SIGN_TEXT_MAX_LENGTH} characters.`);
    }
    configuration.signText = command.signText === null ? null : normalizeSignText(command.signText);
  }
  if (hasOwn(command, 'swordsmanObjectiveMode')) {
    if (command.swordsmanObjectiveMode !== null && !normalizeSwordsmanObjectiveMode(command.swordsmanObjectiveMode)) {
      throw new HttpError(400, `commands[${index}].swordsmanObjectiveMode must be duel, collect, or null.`);
    }
    configuration.swordsmanObjectiveMode = command.swordsmanObjectiveMode as SwordsmanObjectiveMode | null;
  }
  if (hasOwn(command, 'swordsmanDefeatMode')) {
    if (command.swordsmanDefeatMode !== null && !normalizeSwordsmanDefeatMode(command.swordsmanDefeatMode)) {
      throw new HttpError(400, `commands[${index}].swordsmanDefeatMode must be defeatable, invincible, respawn, or null.`);
    }
    configuration.swordsmanDefeatMode = command.swordsmanDefeatMode as SwordsmanDefeatMode | null;
  }
  if (hasOwn(command, 'npcMode')) {
    if (command.npcMode !== null && !normalizeNpcMode(command.npcMode)) throw new HttpError(400, `commands[${index}].npcMode is invalid.`);
    configuration.npcMode = command.npcMode as NpcMode | null;
  }
  for (const key of ['npcPushable', 'npcCanJumpFall', 'npcPlayerCollision', 'npcFriendlyFire'] as const) {
    if (hasOwn(command, key)) configuration[key] = normalizeNullableBoolean(command[key], `commands[${index}].${key}`);
  }
  if (hasOwn(command, 'npcName')) {
    if (command.npcName !== null && typeof command.npcName !== 'string') throw new HttpError(400, `commands[${index}].npcName must be a string or null.`);
    if (typeof command.npcName === 'string' && command.npcName.replace(/\r\n?/g, ' ').trim().length > NPC_NAME_MAX_LENGTH) {
      throw new HttpError(400, `commands[${index}].npcName must be at most ${NPC_NAME_MAX_LENGTH} characters.`);
    }
    configuration.npcName = command.npcName === null ? null : normalizeNpcName(command.npcName);
  }
  if (hasOwn(command, 'npcDefeatMode')) {
    if (command.npcDefeatMode !== null && !normalizeSwordsmanDefeatMode(command.npcDefeatMode)) {
      throw new HttpError(400, `commands[${index}].npcDefeatMode must be defeatable, invincible, respawn, or null.`);
    }
    configuration.npcDefeatMode = command.npcDefeatMode as SwordsmanDefeatMode | null;
  }
  return configuration;
}

function normalizeCommand(value: unknown, index: number, state: NormalizationState): RoomDraftCommand {
  const command = asRecord(value, `commands[${index}]`);
  switch (command.type) {
    case 'set_title':
      assertAllowedKeys(command, ['type', 'title'], `commands[${index}]`);
      return { type: 'set_title', title: normalizeRoomTitle(command.title) ?? null };
    case 'set_background': {
      assertAllowedKeys(command, ['type', 'background'], `commands[${index}]`);
      if (typeof command.background !== 'string') throw new HttpError(400, `commands[${index}].background must be a string.`);
      const background = command.background.trim();
      if (!BACKGROUND_GROUPS.some((group) => group.id === background) && !isSolidColorBackgroundValue(background) && !isCustomBackgroundValue(background)) {
        throw new HttpError(400, `Unknown background "${command.background}".`);
      }
      return { type: 'set_background', background: normalizeRoomBackground(background) };
    }
    case 'set_spawn':
      assertAllowedKeys(command, ['type', 'tileX', 'tileY'], `commands[${index}]`);
      return {
        type: 'set_spawn',
        tileX: normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH),
        tileY: normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT),
      };
    case 'set_goal':
      assertAllowedKeys(command, ['type', 'goal'], `commands[${index}]`);
      return { type: 'set_goal', goal: normalizeGoalCommandValue(command.goal, state.refs) };
    case 'clear_goal':
      assertAllowedKeys(command, ['type'], `commands[${index}]`);
      return { type: 'clear_goal' };
    case 'platform': {
      assertAllowedKeys(command, ['type', 'tilesetKey', 'styleId', 'row', 'colStart', 'colEnd', 'depth'], `commands[${index}]`);
      if (typeof command.tilesetKey !== 'string' || typeof command.styleId !== 'string') throw new HttpError(400, `commands[${index}] requires tilesetKey and styleId.`);
      getBuildStyleOrThrow(command.tilesetKey, command.styleId);
      const row = normalizeTileCoordinate(command.row, `commands[${index}].row`, ROOM_HEIGHT);
      const colStart = normalizeTileCoordinate(command.colStart, `commands[${index}].colStart`, ROOM_WIDTH);
      const colEnd = normalizeTileCoordinate(command.colEnd, `commands[${index}].colEnd`, ROOM_WIDTH);
      if (colEnd < colStart) throw new HttpError(400, `commands[${index}].colEnd must be greater than or equal to colStart.`);
      const depth = normalizePositiveInteger(command.depth, `commands[${index}].depth`);
      if (row + depth > ROOM_HEIGHT) throw new HttpError(400, `commands[${index}] platform exceeds room height.`);
      addTileWrites(state, (colEnd - colStart + 1) * depth);
      return { type: 'platform', tilesetKey: command.tilesetKey, styleId: command.styleId, row, colStart, colEnd, depth };
    }
    case 'fill_rect': {
      assertAllowedKeys(command, ['type', 'tilesetKey', 'styleId', 'role', 'tileX', 'tileY', 'width', 'height'], `commands[${index}]`);
      if (typeof command.tilesetKey !== 'string' || typeof command.styleId !== 'string') throw new HttpError(400, `commands[${index}] requires tilesetKey and styleId.`);
      if (command.role !== 'surface' && command.role !== 'fill') throw new HttpError(400, `commands[${index}].role must be surface or fill.`);
      getBuildStyleOrThrow(command.tilesetKey, command.styleId);
      const rect = normalizeRect(command, index);
      addTileWrites(state, rect.width * rect.height);
      return { type: 'fill_rect', tilesetKey: command.tilesetKey, styleId: command.styleId, role: command.role, ...rect };
    }
    case 'set_tiles': {
      assertAllowedKeys(command, ['type', 'tilesetKey', 'layer', 'tiles'], `commands[${index}]`);
      if (typeof command.tilesetKey !== 'string') throw new HttpError(400, `commands[${index}].tilesetKey must be a string.`);
      const tileset = getTilesetByKey(command.tilesetKey);
      if (!tileset) throw new HttpError(400, `Unknown tilesetKey "${command.tilesetKey}".`);
      if (!Array.isArray(command.tiles) || command.tiles.length === 0) throw new HttpError(400, `commands[${index}].tiles must be a non-empty array.`);
      if (command.tiles.length > MAX_SET_TILES_PER_COMMAND) throw new HttpError(400, `commands[${index}].tiles allows at most ${MAX_SET_TILES_PER_COMMAND} entries.`);
      const tiles = command.tiles.map((value, tileIndex) => {
        const tile = asRecord(value, `commands[${index}].tiles[${tileIndex}]`);
        assertAllowedKeys(tile, ['tileX', 'tileY', 'localIndex', 'flipX', 'flipY'], `commands[${index}].tiles[${tileIndex}]`);
        const localIndex = normalizeNonNegativeInteger(tile.localIndex, `commands[${index}].tiles[${tileIndex}].localIndex`);
        if (localIndex >= tileset.tileCount) throw new HttpError(400, `commands[${index}].tiles[${tileIndex}].localIndex is outside tileset "${tileset.key}".`);
        if (!isTilesetLocalTileEditorEnabled(tileset, localIndex)) throw new HttpError(400, `commands[${index}].tiles[${tileIndex}].localIndex is disabled for editor placement.`);
        if (tile.flipX !== undefined && typeof tile.flipX !== 'boolean') throw new HttpError(400, `commands[${index}].tiles[${tileIndex}].flipX must be a boolean.`);
        if (tile.flipY !== undefined && typeof tile.flipY !== 'boolean') throw new HttpError(400, `commands[${index}].tiles[${tileIndex}].flipY must be a boolean.`);
        return {
          tileX: normalizeTileCoordinate(tile.tileX, `commands[${index}].tiles[${tileIndex}].tileX`, ROOM_WIDTH),
          tileY: normalizeTileCoordinate(tile.tileY, `commands[${index}].tiles[${tileIndex}].tileY`, ROOM_HEIGHT),
          localIndex,
          flipX: tile.flipX ?? false,
          flipY: tile.flipY ?? false,
        };
      });
      addTileWrites(state, tiles.length);
      return { type: 'set_tiles', tilesetKey: tileset.key, layer: normalizeLayer(command.layer, `commands[${index}].layer`), tiles };
    }
    case 'erase_rect': {
      assertAllowedKeys(command, ['type', 'layer', 'tileX', 'tileY', 'width', 'height'], `commands[${index}]`);
      const rect = normalizeRect(command, index);
      addTileWrites(state, rect.width * rect.height);
      return { type: 'erase_rect', layer: command.layer === undefined ? 'terrain' : normalizeLayer(command.layer, `commands[${index}].layer`), ...rect };
    }
    case 'clear_layer':
      assertAllowedKeys(command, ['type', 'layer'], `commands[${index}]`);
      addTileWrites(state, MAX_SET_TILES_PER_COMMAND);
      return { type: 'clear_layer', layer: normalizeLayer(command.layer, `commands[${index}].layer`) };
    case 'place_object': {
      assertAllowedKeys(command, ['type', 'ref', 'objectId', 'tileX', 'tileY', 'facing', 'layer', 'swordsmanObjectiveMode', 'swordsmanDefeatMode'], `commands[${index}]`);
      if (typeof command.objectId !== 'string') throw new HttpError(400, `commands[${index}].objectId must be a string.`);
      const objectConfig = getObjectById(command.objectId);
      if (!objectConfig) throw new HttpError(400, `Unknown objectId "${command.objectId}".`);
      if (command.objectId === 'spawn_point') throw new HttpError(400, 'Use set_spawn instead of place_object for spawn points.');
      if (command.facing !== undefined && command.facing !== 'left' && command.facing !== 'right') throw new HttpError(400, `commands[${index}].facing must be left or right.`);
      if (command.facing !== undefined && !objectConfig.facingDirection) throw new HttpError(400, `commands[${index}].facing is not supported by ${command.objectId}.`);
      if (command.swordsmanObjectiveMode !== undefined && command.objectId !== SWORDSMAN_AI_OBJECT_ID) throw new HttpError(400, `commands[${index}].swordsmanObjectiveMode only applies to swordsman_ai.`);
      if (command.swordsmanDefeatMode !== undefined && command.objectId !== SWORDSMAN_AI_OBJECT_ID) throw new HttpError(400, `commands[${index}].swordsmanDefeatMode only applies to swordsman_ai.`);
      const objectiveMode = command.objectId === SWORDSMAN_AI_OBJECT_ID
        ? normalizeSwordsmanObjectiveMode(command.swordsmanObjectiveMode) ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE
        : undefined;
      const defeatMode = command.objectId === SWORDSMAN_AI_OBJECT_ID
        ? normalizeSwordsmanDefeatMode(command.swordsmanDefeatMode) ?? DEFAULT_SWORDSMAN_DEFEAT_MODE
        : undefined;
      if (command.objectId === SWORDSMAN_AI_OBJECT_ID && command.swordsmanObjectiveMode !== undefined && !normalizeSwordsmanObjectiveMode(command.swordsmanObjectiveMode)) throw new HttpError(400, `commands[${index}].swordsmanObjectiveMode must be duel or collect.`);
      if (command.objectId === SWORDSMAN_AI_OBJECT_ID && command.swordsmanDefeatMode !== undefined && !normalizeSwordsmanDefeatMode(command.swordsmanDefeatMode)) throw new HttpError(400, `commands[${index}].swordsmanDefeatMode is invalid.`);
      const ref = command.ref === undefined ? undefined : normalizeRef(command.ref, `commands[${index}].ref`);
      if (ref && state.refs.has(ref)) throw new HttpError(400, `commands[${index}].ref "${ref}" is already used.`);
      if (ref) state.refs.add(ref);
      return {
        type: 'place_object',
        ref,
        objectId: command.objectId,
        tileX: normalizeTileCoordinate(command.tileX, `commands[${index}].tileX`, ROOM_WIDTH),
        tileY: normalizeTileCoordinate(command.tileY, `commands[${index}].tileY`, ROOM_HEIGHT),
        facing: command.facing,
        layer: normalizeOptionalLayer(command.layer, `commands[${index}].layer`),
        swordsmanObjectiveMode: objectiveMode,
        swordsmanDefeatMode: defeatMode,
      };
    }
    case 'configure_object': {
      const configurationKeys = [
        'layer', 'facing', 'linkedTargets', 'containedObjectId', 'signText',
        'swordsmanObjectiveMode', 'swordsmanDefeatMode', 'npcMode', 'npcPushable',
        'npcCanJumpFall', 'npcPlayerCollision', 'npcFriendlyFire', 'npcName', 'npcDefeatMode',
      ] as const;
      assertAllowedKeys(command, ['type', 'target', ...configurationKeys], `commands[${index}]`);
      if (!configurationKeys.some((key) => hasOwn(command, key))) throw new HttpError(400, `commands[${index}] must include at least one configuration field.`);
      return {
        type: 'configure_object',
        target: normalizeSelector(command.target, `commands[${index}].target`, state.refs),
        ...normalizeConfiguration(command, index, state),
      };
    }
    case 'remove_object':
      assertAllowedKeys(command, ['type', 'target'], `commands[${index}]`);
      return { type: 'remove_object', target: normalizeSelector(command.target, `commands[${index}].target`, state.refs) };
    case 'remove_objects_in_rect': {
      assertAllowedKeys(command, ['type', 'tileX', 'tileY', 'width', 'height'], `commands[${index}]`);
      return { type: 'remove_objects_in_rect', ...normalizeRect(command, index) };
    }
    case 'clear_objects':
      assertAllowedKeys(command, ['type'], `commands[${index}]`);
      return { type: 'clear_objects' };
    default:
      throw new HttpError(400, `commands[${index}].type is invalid.`);
  }
}

export function normalizeRoomDraftCommandsRequestBody(value: unknown): RoomDraftCommandsRequestBody {
  const body = asRecord(value, 'Request body');
  assertAllowedKeys(body, ['base', 'commands'], 'Request body');
  if (!Array.isArray(body.commands) || body.commands.length === 0) throw new HttpError(400, 'commands must be a non-empty array.');
  if (body.commands.length > MAX_ROOM_DRAFT_COMMANDS) throw new HttpError(400, `commands allows at most ${MAX_ROOM_DRAFT_COMMANDS} entries.`);
  const state: NormalizationState = { refs: new Set<string>(), tileWrites: 0 };
  return {
    base: normalizeBase(body.base),
    commands: body.commands.map((command, index) => normalizeCommand(command, index, state)),
  };
}

function pickPlatformTile(localIndices: number[], index: number, width: number): number {
  if (localIndices.length === 0) throw new HttpError(500, 'Build style is missing tile indices.');
  if (width <= 1) return localIndices[Math.floor(localIndices.length / 2)] ?? localIndices[0];
  if (index === 0) return localIndices[0];
  if (index === width - 1) return localIndices[localIndices.length - 1];
  const middleIndices = localIndices.slice(1, -1);
  if (middleIndices.length === 0) return localIndices[Math.min(1, localIndices.length - 1)] ?? localIndices[0];
  return middleIndices[(index - 1) % middleIndices.length] ?? middleIndices[0];
}

function resolveSelector(selector: ObjectSelector, refs: ReadonlyMap<string, string>): string {
  if (selector.ref) {
    const instanceId = refs.get(selector.ref);
    if (!instanceId) throw new HttpError(400, `Unresolved object ref "${selector.ref}".`);
    return instanceId;
  }
  if (selector.instanceId) return selector.instanceId;
  throw new HttpError(400, 'Object selector is invalid.');
}

function findObject(room: RoomSnapshot, selector: ObjectSelector, refs: ReadonlyMap<string, string>, label: string): PlacedObject {
  const instanceId = resolveSelector(selector, refs);
  const placed = room.placedObjects.find((candidate) => candidate.instanceId === instanceId);
  if (!placed) throw new HttpError(400, `${label} does not resolve to an object in the selected snapshot.`);
  return placed;
}

function placeObjectAtTile(command: PlaceObjectCommand): PlacedObject {
  const objectConfig = getObjectById(command.objectId);
  if (!objectConfig) throw new HttpError(400, `Unknown objectId "${command.objectId}".`);
  const placementPoint = getObjectPlacementPointForTile(objectConfig, command.tileX, command.tileY);
  const npc = isNpcObjectId(command.objectId);
  return {
    id: command.objectId,
    x: placementPoint.x,
    y: placementPoint.y,
    instanceId: createPlacedObjectInstanceId(),
    facing: objectConfig.facingDirection ? command.facing : undefined,
    layer: command.layer,
    triggerTargetInstanceId: null,
    linkedTargetInstanceIds: null,
    containedObjectId: null,
    signText: null,
    swordsmanObjectiveMode: command.objectId === SWORDSMAN_AI_OBJECT_ID
      ? command.swordsmanObjectiveMode ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE
      : null,
    swordsmanDefeatMode: command.objectId === SWORDSMAN_AI_OBJECT_ID
      ? command.swordsmanDefeatMode ?? DEFAULT_SWORDSMAN_DEFEAT_MODE
      : null,
    npcMode: npc ? DEFAULT_NPC_MODE : null,
    npcPushable: npc ? normalizeNpcPushable(null, DEFAULT_NPC_MODE) : null,
    npcCanJumpFall: npc ? normalizeNpcCanJumpFall(null, DEFAULT_NPC_MODE) : null,
    npcPlayerCollision: npc ? normalizeNpcPlayerCollision(null) : null,
    npcFriendlyFire: npc ? normalizeNpcFriendlyFire(null) : null,
    npcName: npc ? objectConfig.name : null,
    npcDefeatMode: npc ? getPlacedNpcDefeatMode({ id: command.objectId }) : null,
  };
}

function applyObjectConfiguration(room: RoomSnapshot, placed: PlacedObject, command: ConfigureObjectCommand, refs: ReadonlyMap<string, string>): void {
  const objectConfig = getObjectById(placed.id);
  if (!objectConfig) throw new HttpError(400, `Object "${placed.id}" is not a configurable built-in object.`);
  if (command.layer !== undefined) placed.layer = command.layer ?? undefined;
  if (command.facing !== undefined) {
    if (!objectConfig.facingDirection) throw new HttpError(400, `Object "${placed.id}" does not support facing.`);
    placed.facing = command.facing ?? undefined;
  }
  if (command.linkedTargets !== undefined) {
    if (!canPlacedObjectUseObjectLink(placed)) throw new HttpError(400, `Object "${placed.id}" does not support linked targets.`);
    const maximumTargets = placed.id === MOVING_PLATFORM_OBJECT_ID ? MAX_PLACED_OBJECT_PATH_TARGETS : 1;
    if (command.linkedTargets.length > maximumTargets) throw new HttpError(400, `Object "${placed.id}" allows at most ${maximumTargets} linked target${maximumTargets === 1 ? '' : 's'}.`);
    const targetIds: string[] = [];
    const seen = new Set<string>();
    for (const selector of command.linkedTargets) {
      const target = findObject(room, selector, refs, 'linkedTargets entry');
      if (target.instanceId === placed.instanceId) throw new HttpError(400, 'An object cannot link to itself.');
      if (seen.has(target.instanceId)) throw new HttpError(400, `Duplicate linked target "${target.instanceId}".`);
      if (!canPlacedObjectBeLinkedObjectTarget(placed, target)) throw new HttpError(400, `Object "${target.id}" is not a valid link target for "${placed.id}".`);
      seen.add(target.instanceId);
      targetIds.push(target.instanceId);
    }
    placed.triggerTargetInstanceId = targetIds[0] ?? null;
    placed.linkedTargetInstanceIds = placed.id === MOVING_PLATFORM_OBJECT_ID && targetIds.length > 0 ? targetIds : null;
  }
  if (command.containedObjectId !== undefined) {
    if (!canPlacedObjectBeContainer(placed)) throw new HttpError(400, `Object "${placed.id}" is not a container.`);
    if (command.containedObjectId !== null && !canObjectBeStoredInContainer(placed.id, getObjectById(command.containedObjectId))) {
      throw new HttpError(400, `Object "${command.containedObjectId}" cannot be stored in "${placed.id}".`);
    }
    placed.containedObjectId = command.containedObjectId;
  }
  if (command.signText !== undefined) {
    if (!canPlacedObjectHaveSignText({ id: placed.id, customSpriteKind: placed.customSpriteKind })) {
      throw new HttpError(400, `Object "${placed.id}" does not support sign text.`);
    }
    placed.signText = command.signText;
  }
  const hasSwordsmanConfiguration = command.swordsmanObjectiveMode !== undefined || command.swordsmanDefeatMode !== undefined;
  if (hasSwordsmanConfiguration && placed.id !== SWORDSMAN_AI_OBJECT_ID) throw new HttpError(400, 'Sword Hunter settings only apply to swordsman_ai.');
  if (command.swordsmanObjectiveMode !== undefined) placed.swordsmanObjectiveMode = command.swordsmanObjectiveMode ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
  if (command.swordsmanDefeatMode !== undefined) placed.swordsmanDefeatMode = command.swordsmanDefeatMode ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
  const hasNpcConfiguration = [
    command.npcMode,
    command.npcPushable,
    command.npcCanJumpFall,
    command.npcPlayerCollision,
    command.npcFriendlyFire,
    command.npcName,
    command.npcDefeatMode,
  ].some((value) => value !== undefined);
  if (hasNpcConfiguration && !isNpcObjectId(placed.id)) throw new HttpError(400, 'NPC settings only apply to built-in NPC objects.');
  if (isNpcObjectId(placed.id)) {
    const mode = command.npcMode === undefined
      ? normalizeNpcMode(placed.npcMode) ?? DEFAULT_NPC_MODE
      : command.npcMode ?? DEFAULT_NPC_MODE;
    if (command.npcMode !== undefined) placed.npcMode = mode;
    if (command.npcPushable !== undefined) placed.npcPushable = normalizeNpcPushable(command.npcPushable, mode);
    if (command.npcCanJumpFall !== undefined) placed.npcCanJumpFall = normalizeNpcCanJumpFall(command.npcCanJumpFall, mode);
    if (command.npcPlayerCollision !== undefined) placed.npcPlayerCollision = normalizeNpcPlayerCollision(command.npcPlayerCollision);
    if (command.npcFriendlyFire !== undefined) placed.npcFriendlyFire = normalizeNpcFriendlyFire(command.npcFriendlyFire);
    if (command.npcName !== undefined) placed.npcName = normalizeNpcName(command.npcName, objectConfig.name);
    if (command.npcDefeatMode !== undefined) placed.npcDefeatMode = normalizeNpcDefeatMode(command.npcDefeatMode);
  }
}

function applyObjectRectRemoval(room: RoomSnapshot, command: RemoveObjectsInRectCommand): void {
  const minX = command.tileX * TILE_SIZE;
  const minY = command.tileY * TILE_SIZE;
  const maxX = minX + command.width * TILE_SIZE;
  const maxY = minY + command.height * TILE_SIZE;
  room.placedObjects = room.placedObjects.filter((placed) => !(placed.x >= minX && placed.x < maxX && placed.y >= minY && placed.y < maxY));
}

export function applyRoomDraftCommands(baseSnapshot: RoomSnapshot, commands: readonly RoomDraftCommand[]): ApplyRoomDraftCommandsResult {
  const room = cloneRoomSnapshot(baseSnapshot);
  const refs = new Map<string, string>();
  for (const command of commands) {
    switch (command.type) {
      case 'set_title': room.title = command.title; break;
      case 'set_background': room.background = normalizeRoomBackground(command.background); break;
      case 'set_spawn': room.spawnPoint = createGoalMarkerPointFromTile(command.tileX, command.tileY); break;
      case 'set_goal': {
        if (command.goal.type !== 'npc_quest' || !('npc' in command.goal)) {
          room.goal = normalizeRoomGoal(command.goal);
          break;
        }
        const npc = findObject(room, command.goal.npc, refs, 'npc_quest NPC');
        if (!isNpcObjectId(npc.id)) throw new HttpError(400, 'npc_quest must reference a built-in NPC object.');
        room.goal = normalizeRoomGoal({
          type: 'npc_quest',
          questType: command.goal.questType,
          npcInstanceId: npc.instanceId,
          durationMs: command.goal.durationMs,
          requiredCount: command.goal.requiredCount,
          destination: command.goal.destination,
        });
        break;
      }
      case 'clear_goal': room.goal = null; break;
      case 'platform': {
        const style = getBuildStyleOrThrow(command.tilesetKey, command.styleId);
        const width = command.colEnd - command.colStart + 1;
        for (let xOffset = 0; xOffset < width; xOffset += 1) {
          const tileX = command.colStart + xOffset;
          room.tileData.terrain[command.row][tileX] = pickPlatformTile(style.surfaceGids, xOffset, width);
          for (let yOffset = 1; yOffset < command.depth; yOffset += 1) {
            room.tileData.terrain[command.row + yOffset][tileX] = pickPlatformTile(style.fillGids, xOffset, width);
          }
        }
        break;
      }
      case 'fill_rect': {
        const style = getBuildStyleOrThrow(command.tilesetKey, command.styleId);
        const gids = command.role === 'surface' ? style.surfaceGids : style.fillGids;
        for (let yOffset = 0; yOffset < command.height; yOffset += 1) {
          for (let xOffset = 0; xOffset < command.width; xOffset += 1) {
            room.tileData.terrain[command.tileY + yOffset][command.tileX + xOffset] = pickPlatformTile(gids, xOffset, command.width);
          }
        }
        break;
      }
      case 'set_tiles': {
        const tileset = getTilesetByKey(command.tilesetKey);
        if (!tileset) throw new HttpError(400, `Unknown tilesetKey "${command.tilesetKey}".`);
        for (const tile of command.tiles) {
          room.tileData[command.layer][tile.tileY][tile.tileX] = encodeTileDataValue(
            tileset.firstGid + tile.localIndex,
            tile.flipX,
            tile.flipY,
          );
        }
        break;
      }
      case 'erase_rect':
        for (let yOffset = 0; yOffset < command.height; yOffset += 1) {
          for (let xOffset = 0; xOffset < command.width; xOffset += 1) room.tileData[command.layer][command.tileY + yOffset][command.tileX + xOffset] = -1;
        }
        break;
      case 'clear_layer':
        for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
          for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) room.tileData[command.layer][tileY][tileX] = -1;
        }
        break;
      case 'place_object': {
        const placed = placeObjectAtTile(command);
        room.placedObjects.push(placed);
        if (command.ref) refs.set(command.ref, placed.instanceId);
        break;
      }
      case 'configure_object':
        applyObjectConfiguration(room, findObject(room, command.target, refs, 'configure_object target'), command, refs);
        break;
      case 'remove_object': {
        const instanceId = resolveSelector(command.target, refs);
        const index = room.placedObjects.findIndex((candidate) => candidate.instanceId === instanceId);
        if (index < 0) throw new HttpError(400, 'remove_object target does not resolve to an object in the selected snapshot.');
        room.placedObjects.splice(index, 1);
        break;
      }
      case 'remove_objects_in_rect': applyObjectRectRemoval(room, command); break;
      case 'clear_objects': room.placedObjects = []; break;
    }
  }
  const persistedIds = new Set(room.placedObjects.map((placed) => placed.instanceId));
  return {
    snapshot: room,
    commandRefs: Object.fromEntries(Array.from(refs).filter(([, instanceId]) => persistedIds.has(instanceId))),
  };
}
