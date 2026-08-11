import {
  BACKGROUND_GROUPS,
  CONTAINER_OBJECT_IDS,
  GAME_OBJECTS,
  LAYER_NAMES,
  MOVING_PLATFORM_ENDPOINT_OBJECT_ID,
  MOVING_PLATFORM_OBJECT_ID,
  PORTAL_A_OBJECT_ID,
  PORTAL_B_OBJECT_ID,
  PRESSURE_PLATE_TARGET_OBJECT_IDS,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  isTilesetLocalTileEditorEnabled,
  type GameObjectConfig,
  type TerrainCollisionProfileId,
  type TilesetConfig,
} from '../config';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
  SWORDSMAN_DEFEAT_MODES,
  SWORDSMAN_OBJECTIVE_MODES,
} from '../enemies/swordsmanObjectives';
import { SWORDSMAN_AI_OBJECT_ID } from '../enemies/swordsmanAi';
import {
  NPC_DIALOGUE_MAX_LENGTH,
  NPC_MODES,
  NPC_NAME_MAX_LENGTH,
  isNpcObjectId,
} from '../npcs/model';
import { MAX_PLACED_OBJECT_PATH_TARGETS } from '../placedObjects/objectPaths';
import { SIGN_TEXT_MAX_LENGTH, canPlacedObjectHaveSignText } from '../signs/model';
import {
  NPC_QUEST_TYPES,
  ROOM_GOAL_LABELS,
  ROOM_GOAL_TYPES,
  createDefaultRoomGoal,
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
import {
  getAgentTilesetCatalog,
  renderAgentTilesetMarkdown,
  type AgentTilesetCatalogEntry,
} from './tilesetCatalog';
import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../worldTiles/assetContract';

export const AUTHORING_CATALOG_SCHEMA_VERSION = 1 as const;
export const AUTHORING_CATALOG_CACHE_CONTROL = 'public, max-age=300';

export interface AuthoringTilesetCatalogEntry extends AgentTilesetCatalogEntry {
  assetPath: string;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  rows: number;
  tileCount: number;
  collisionLocalIndices: Record<TerrainCollisionProfileId, number[]>;
  disabledEditorLocalIndices: number[];
}

export interface AuthoringObjectCapabilities {
  placeable: boolean;
  layers: readonly string[];
  facing: {
    supported: boolean;
    default: 'left' | 'right' | null;
  };
  links: {
    supported: boolean;
    ordered: boolean;
    maximumTargets: number;
    targetObjectIds: string[];
  };
  container: {
    supported: boolean;
    allowedObjectIds: string[];
  };
  signText: {
    supported: boolean;
    maximumLength: number;
  };
  swordsman: {
    objectiveModes: readonly string[];
    defeatModes: readonly string[];
    defaults: {
      objectiveMode: string;
      defeatMode: string;
    };
  } | null;
  npc: {
    modes: readonly string[];
    defeatModes: readonly string[];
    nameMaximumLength: number;
    dialogueMaximumLength: number;
  } | null;
}

export interface AuthoringObjectCatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  assetPath: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  bodyWidth: number;
  bodyHeight: number;
  behavior: string;
  capabilities: AuthoringObjectCapabilities;
}

export interface AuthoringGoalPolicy {
  label: string;
  requirements: string[];
  commandFields: string[];
  defaults: RoomGoal;
}

export const AUTHORING_GOAL_POLICIES = {
  reach_exit: {
    label: ROOM_GOAL_LABELS.reach_exit,
    requirements: ['exit tile marker'],
    commandFields: ['exit', 'timeLimitMs'],
    defaults: createDefaultRoomGoal('reach_exit'),
  },
  collect_target: {
    label: ROOM_GOAL_LABELS.collect_target,
    requirements: ['positive requiredCount', 'enough collectible objects to publish'],
    commandFields: ['requiredCount', 'timeLimitMs'],
    defaults: createDefaultRoomGoal('collect_target'),
  },
  collect_race: {
    label: ROOM_GOAL_LABELS.collect_race,
    requirements: ['at least one collectible', 'exactly one swordsman_ai configured with objective mode collect'],
    commandFields: ['timeLimitMs'],
    defaults: createDefaultRoomGoal('collect_race'),
  },
  defeat_all: {
    label: ROOM_GOAL_LABELS.defeat_all,
    requirements: [],
    commandFields: ['timeLimitMs'],
    defaults: createDefaultRoomGoal('defeat_all'),
  },
  checkpoint_sprint: {
    label: ROOM_GOAL_LABELS.checkpoint_sprint,
    requirements: ['at least one checkpoint tile marker', 'finish tile marker'],
    commandFields: ['checkpoints', 'finish', 'timeLimitMs'],
    defaults: createDefaultRoomGoal('checkpoint_sprint'),
  },
  survival: {
    label: ROOM_GOAL_LABELS.survival,
    requirements: ['positive durationMs'],
    commandFields: ['durationMs'],
    defaults: createDefaultRoomGoal('survival'),
  },
  npc_quest: {
    label: ROOM_GOAL_LABELS.npc_quest,
    requirements: [
      `questType is one of ${NPC_QUEST_TYPES.join(', ')}`,
      'npc identifies an earlier request ref or npcInstanceId identifies an existing NPC',
      'protect uses positive durationMs',
      'escort uses a destination tile marker',
      'give uses positive requiredCount and enough collectibles to publish',
    ],
    commandFields: ['questType', 'npc', 'npcInstanceId', 'durationMs', 'requiredCount', 'destination'],
    defaults: createDefaultRoomGoal('npc_quest'),
  },
} satisfies Record<RoomGoalType, AuthoringGoalPolicy>;

function collisionIndices(tileset: TilesetConfig, profile: TerrainCollisionProfileId): number[] {
  const indices: number[] = [];
  for (let localIndex = 0; localIndex < tileset.tileCount; localIndex += 1) {
    const configured = tileset.terrainCollisionProfiles?.[localIndex] ?? 'full';
    if (configured === profile) indices.push(localIndex);
  }
  return indices;
}

function buildTilesetCatalog(): AuthoringTilesetCatalogEntry[] {
  const legacyByKey = new Map(getAgentTilesetCatalog().map((entry) => [entry.key, entry]));
  return TILESETS.map((tileset) => {
    const legacy = legacyByKey.get(tileset.key);
    if (!legacy) throw new Error(`Missing legacy authoring tileset projection for ${tileset.key}.`);
    const disabledEditorLocalIndices = Array.from({ length: tileset.tileCount }, (_, index) => index)
      .filter((localIndex) => !isTilesetLocalTileEditorEnabled(tileset, localIndex));
    return {
      ...legacy,
      assetPath: tileset.path,
      imageWidth: tileset.imageWidth,
      imageHeight: tileset.imageHeight,
      columns: tileset.columns,
      rows: tileset.rows,
      tileCount: tileset.tileCount,
      collisionLocalIndices: {
        full: collisionIndices(tileset, 'full'),
        decoratedTop: collisionIndices(tileset, 'decoratedTop'),
        none: collisionIndices(tileset, 'none'),
      },
      disabledEditorLocalIndices,
    };
  });
}

function getLinkTargetObjectIds(config: GameObjectConfig): string[] {
  if (config.id === 'floor_trigger') return [...PRESSURE_PLATE_TARGET_OBJECT_IDS];
  if (config.id === MOVING_PLATFORM_OBJECT_ID) return [MOVING_PLATFORM_ENDPOINT_OBJECT_ID];
  if (config.id === PORTAL_A_OBJECT_ID) return [PORTAL_B_OBJECT_ID];
  if (config.id === PORTAL_B_OBJECT_ID) return [PORTAL_A_OBJECT_ID];
  return [];
}

function getAllowedContainerObjectIds(config: GameObjectConfig): string[] {
  if (!(CONTAINER_OBJECT_IDS as readonly string[]).includes(config.id)) return [];
  return GAME_OBJECTS
    .filter((candidate) => candidate.id !== 'spawn_point' && canObjectBeStoredInContainer(config.id, candidate))
    .map((candidate) => candidate.id);
}

function buildObjectCatalogEntry(config: GameObjectConfig): AuthoringObjectCatalogEntry {
  const targetObjectIds = getLinkTargetObjectIds(config);
  const ordered = config.id === MOVING_PLATFORM_OBJECT_ID;
  const container = canPlacedObjectBeContainer({ id: config.id });
  const signText = canPlacedObjectHaveSignText({ id: config.id });
  return {
    id: config.id,
    name: config.name,
    category: config.category,
    description: config.description,
    assetPath: config.path,
    frameWidth: config.frameWidth,
    frameHeight: config.frameHeight,
    frameCount: config.frameCount,
    bodyWidth: config.bodyWidth,
    bodyHeight: config.bodyHeight,
    behavior: config.behavior,
    capabilities: {
      placeable: config.id !== 'spawn_point',
      layers: LAYER_NAMES,
      facing: {
        supported: Boolean(config.facingDirection),
        default: config.facingDirection ?? null,
      },
      links: {
        supported: targetObjectIds.length > 0,
        ordered,
        maximumTargets: ordered ? MAX_PLACED_OBJECT_PATH_TARGETS : targetObjectIds.length > 0 ? 1 : 0,
        targetObjectIds,
      },
      container: {
        supported: container,
        allowedObjectIds: getAllowedContainerObjectIds(config),
      },
      signText: {
        supported: signText,
        maximumLength: signText ? SIGN_TEXT_MAX_LENGTH : 0,
      },
      swordsman: config.id === SWORDSMAN_AI_OBJECT_ID
        ? {
            objectiveModes: SWORDSMAN_OBJECTIVE_MODES,
            defeatModes: SWORDSMAN_DEFEAT_MODES,
            defaults: {
              objectiveMode: DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
              defeatMode: DEFAULT_SWORDSMAN_DEFEAT_MODE,
            },
          }
        : null,
      npc: isNpcObjectId(config.id)
        ? {
            modes: NPC_MODES,
            defeatModes: SWORDSMAN_DEFEAT_MODES,
            nameMaximumLength: NPC_NAME_MAX_LENGTH,
            dialogueMaximumLength: NPC_DIALOGUE_MAX_LENGTH,
          }
        : null,
    },
  };
}

export function getAuthoringCatalog() {
  return {
    schemaVersion: AUTHORING_CATALOG_SCHEMA_VERSION,
    rendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
    room: {
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
      tileSize: TILE_SIZE,
      layers: [...LAYER_NAMES],
    },
    tilesets: buildTilesetCatalog(),
    objects: GAME_OBJECTS.map(buildObjectCatalogEntry),
    backgrounds: {
      solidColorSyntax: 'solid:#RRGGBB',
      groups: BACKGROUND_GROUPS.map((group) => ({
        ...group,
        layers: group.layers.map((layer) => ({ ...layer })),
      })),
    },
    goals: ROOM_GOAL_TYPES.map((type) => ({
      type,
      ...AUTHORING_GOAL_POLICIES[type],
    })),
  };
}

export type AuthoringCatalog = ReturnType<typeof getAuthoringCatalog>;

function renderObjectCatalog(): string {
  const catalog = getAuthoringCatalog();
  const categories = Array.from(new Set(catalog.objects.map((entry) => entry.category)));
  return categories.map((category) => {
    const entries = catalog.objects.filter((entry) => entry.category === category);
    return [
      `### ${category}`,
      '',
      ...entries.map((entry) => {
        const capabilities = [
          entry.capabilities.facing.supported ? 'facing' : null,
          entry.capabilities.links.supported ? (entry.capabilities.links.ordered ? 'ordered path' : 'link') : null,
          entry.capabilities.container.supported ? 'container' : null,
          entry.capabilities.signText.supported ? 'text' : null,
          entry.capabilities.swordsman ? 'Sword Hunter settings' : null,
          entry.capabilities.npc ? 'NPC settings' : null,
        ].filter(Boolean);
        return `- \`${entry.id}\` — ${entry.name}${entry.capabilities.placeable ? '' : ' (not placeable; use set_spawn)'}${capabilities.length > 0 ? `; ${capabilities.join(', ')}` : ''}`;
      }),
      '',
    ].join('\n');
  }).join('\n');
}

function renderGoalCatalog(): string {
  return getAuthoringCatalog().goals.map((goal) => [
    `### \`${goal.type}\` — ${goal.label}`,
    '',
    `- Command fields: ${goal.commandFields.length > 0 ? goal.commandFields.map((field) => `\`${field}\``).join(', ') : 'none'}`,
    `- Requirements: ${goal.requirements.length > 0 ? goal.requirements.join('; ') : 'none'}`,
    `- Defaults: \`${JSON.stringify(goal.defaults)}\``,
    '',
  ].join('\n')).join('\n');
}

export function renderAgentRoomAuthoringMarkdown(): string {
  const catalog = getAuthoringCatalog();
  return [
    '# Agent Room Authoring Reference',
    '',
    'This guide is generated from the same built-in registries as `GET /api/authoring/catalog`.',
    '',
    '## Discoverability first',
    '',
    '- Read `GET /api/authoring/catalog` before building. It is the complete versioned catalog for built-in tilesets, objects, backgrounds, and goals.',
    '- `GET /api/tilesets` remains the legacy terrain-only projection.',
    '- Prefer `POST /api/rooms/{roomId}/draft/commands` for validated, atomic first-pass builds.',
    '- Raw `PUT /api/rooms/{roomId}/draft` remains available for advanced snapshot edits.',
    '',
    '## Room and tile coordinates',
    '',
    `- Rooms are ${catalog.room.width} by ${catalog.room.height} tiles at ${catalog.room.tileSize} pixels per tile.`,
    `- Tile layers: ${catalog.room.layers.map((layer) => `\`${layer}\``).join(', ')}.`,
    '- `set_tiles` accepts `{tilesetKey, layer, tiles[]}`. Each tile has `tileX`, `tileY`, `localIndex`, and optional `flipX` / `flipY`.',
    '- Every editor-enabled local index in every cataloged tileset can be stamped. Curated build styles are optional helpers for `platform` and `fill_rect`.',
    '- Empty tile cells are `-1`; use `erase_rect` or `clear_layer` instead of guessing encoded gids.',
    '',
    '## Atomic command limits',
    '',
    '- Maximum body: 2 MB.',
    '- Maximum commands: 512.',
    `- Maximum tiles in one \`set_tiles\`: ${ROOM_WIDTH * ROOM_HEIGHT}.`,
    `- Maximum cumulative tile writes: ${ROOM_WIDTH * ROOM_HEIGHT * LAYER_NAMES.length}.`,
    '- The full list is validated and applied in order before one save. A failure saves nothing.',
    '',
    '## Request-local object refs',
    '',
    '- `place_object.ref` is optional, unique within the request, and at most 64 characters.',
    '- `configure_object` and `remove_object` select a target with `{ "ref": "name" }` or `{ "instanceId": "obj_..." }`.',
    '- Refs resolve only to an earlier `place_object` in the same request. Instance ids resolve against the selected base snapshot or already placed objects.',
    '- Link targets and NPC quests use the same selector shape. Ordered moving-platform targets preserve array order and allow at most 12 stops.',
    '- The response includes `commandRefs`, mapping each request ref to the persisted object instance id.',
    '',
    '## Object configuration fields',
    '',
    '- General: `layer`, `facing`.',
    '- Links: `linkedTargets` (use `[]` to clear). The source and targets must advertise compatible link capabilities.',
    '- Containers: `containedObjectId` (use `null` to clear). Contents must be allowed by the catalog.',
    '- Text: `signText` (use `null` to clear). Signs and NPCs support text.',
    '- Sword Hunter: `swordsmanObjectiveMode`, `swordsmanDefeatMode`.',
    '- NPC: `npcMode`, `npcPushable`, `npcCanJumpFall`, `npcPlayerCollision`, `npcFriendlyFire`, `npcName`, `npcDefeatMode`.',
    '- Unsupported fields are rejected; they are never silently discarded.',
    '',
    '## Backgrounds',
    '',
    `- Built-in ids: ${catalog.backgrounds.groups.map((group) => `\`${group.id}\``).join(', ')}.`,
    `- Solid color syntax: \`${catalog.backgrounds.solidColorSyntax}\`.`,
    '',
    '## Goals',
    '',
    renderGoalCatalog(),
    '## Built-in objects',
    '',
    renderObjectCatalog(),
    '## Safe first-pass pattern',
    '',
    '1. Read the target room and nearby published rooms.',
    '2. Read the unified authoring catalog.',
    '3. Submit one atomic command list: title, background, spawn, tiles, objects, object configuration, and goal.',
    '4. Re-read the room and verify the returned `commandRefs`, draft, goal, terrain, and object configuration.',
    '5. Publish only after the draft validates and is playable.',
    '',
  ].join('\n');
}

export function renderAuthoringDocuments(): Record<'agent-tilesets.md' | 'agent-room-authoring.md', string> {
  return {
    'agent-tilesets.md': renderAgentTilesetMarkdown(),
    'agent-room-authoring.md': renderAgentRoomAuthoringMarkdown(),
  };
}
