import type Phaser from 'phaser';
import type { GameObjectConfig, LayerName } from '../../../config';
import type { SwordsmanAiState } from '../../../enemies/swordsmanAi';
import type { PoliceBehaviorMode } from '../../../enemies/policeEnemy';
import type {
  SwordsmanDefeatMode,
  SwordsmanObjectiveMode,
} from '../../../enemies/swordsmanObjectives';
import type { SwordsmanTraversalIntent } from '../../../enemies/swordsmanTraversal';
import type { SwordsmanTraversalPlannerMode } from '../../../enemies/swordsmanRobustPlanner';
import type { NpcMode } from '../../../npcs/model';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { PlayerGravityDirection } from '../specialTiles';

interface SwordsmanTraversalBlockState {
  edgeId: string;
  until: number;
}

type SwordsmanCollectState = 'sweep' | 'route' | 'jump';

export interface LoadedRoomObjectRuntimeState {
  baseX: number;
  baseY: number;
  previousX: number;
  previousY: number;
  gravityDirection: PlayerGravityDirection;
  gravityRoomId: string | null;
  inWater: boolean;
  specialTileWindX: -1 | 0 | 1;
  specialTileOnIce: boolean;
  specialTileOnSticky: boolean;
  specialTileOnBounce: boolean;
  specialTileOnDamage: boolean;
  initialDirectionX: number;
  directionX: number;
  movingPlatformTargetIndex: number;
  movingPlatformPathDirection: -1 | 1;
  aiFacingDirectionX: number;
  aiFacingLastFlipAt: number;
  aiFacingLastFlipX: number;
  elapsedMs: number;
  nextActionAt: number;
  actionStartedAt: number;
  aiTraversalCooldownUntil: number;
  cooldownUntil: number;
  activatedUntil: number;
  aiState: SwordsmanAiState | null;
  aiObjectiveMode: SwordsmanObjectiveMode | null;
  aiDefeatMode: SwordsmanDefeatMode | null;
  aiIntent: SwordsmanTraversalIntent | null;
  aiTargetX: number | null;
  aiCurrentSegmentId: string | null;
  aiTargetSegmentId: string | null;
  aiTraversalEdgeId: string | null;
  aiTraversalBlockedEdges: SwordsmanTraversalBlockState[];
  aiTraversalLastBlockReason: string | null;
  aiActiveTraversalEdgeId: string | null;
  aiActiveTraversalNextNodeId: string | null;
  aiActiveTraversalStartedAt: number;
  aiActiveTraversalStartBottom: number;
  aiLadderTraversalEdgeId: string | null;
  aiFallbackTraversalEdgeId: string | null;
  aiFallbackTraversalSegmentId: string | null;
  aiFallbackTraversalLastProgressAt: number;
  aiFallbackTraversalBestMetric: number;
  aiRouteLoopSignature: string | null;
  aiRouteLoopCount: number;
  aiRouteLoopLastProgressAt: number;
  aiRouteLoopBestMetric: number;
  aiPlannerMode: SwordsmanTraversalPlannerMode | null;
  aiPlannerFallback: boolean;
  aiPlannerPlanMs: number;
  aiPlannerExpandedStates: number;
  aiPlannerSimulatedEdges: number;
  aiPlannedTraversalEdgeIds: string[];
  aiPlannedTraversalTargetNodeId: string | null;
  aiPlannedTraversalExpiresAt: number;
  aiPlannedTraversalReason: string | null;
  aiCollectState: SwordsmanCollectState | null;
  aiCollectRouteTargetNodeId: string | null;
  aiCollectRouteExpiresAt: number;
  aiCollectRouteScore: number | null;
  aiCollectRouteValue: number;
  aiCollectRoutePenalty: number;
  policeBehaviorMode: PoliceBehaviorMode | null;
  policePatrolShoots: boolean;
  npcMode: NpcMode | null;
  npcPushable: boolean;
  npcCanJumpFall: boolean;
  npcPlayerCollision: boolean;
  npcFriendlyFire: boolean;
  npcDefeatMode: SwordsmanDefeatMode | null;
  npcVictorious: boolean;
  npcWalking: boolean;
  npcBounceCooldownUntil: number;
  npcQuicksandUntil: number;
  pressureActive: boolean;
  triggerLatched: boolean;
}

export interface LoadedRoomObject {
  key: string;
  placedInstanceId: string | null;
  linkedTargetRoomId: string | null;
  linkedTargetInstanceId: string | null;
  linkedTargetInstanceIds: string[];
  linkedTargetWorldX: number | null;
  linkedTargetWorldY: number | null;
  containedObjectId: string | null;
  signText: string | null;
  npcName: string | null;
  npcNameLabel: Phaser.GameObjects.Text | null;
  layer: LayerName;
  countsTowardGoals: boolean;
  config: GameObjectConfig;
  sprite: Phaser.GameObjects.Sprite;
  helpers: Phaser.GameObjects.GameObject[];
  interactions: Phaser.Physics.Arcade.Collider[];
  worldColliders: Phaser.Physics.Arcade.Collider[];
  runtime: LoadedRoomObjectRuntimeState;
}

export interface CreateLiveObjectEntryOptions {
  key: string;
  config: GameObjectConfig;
  x: number;
  y: number;
  facing?: 'left' | 'right';
  layer?: LayerName;
  baseTimeSeed?: number;
  placedInstanceId: string | null;
  linkedTargetRoomId: string | null;
  linkedTargetInstanceId: string | null;
  linkedTargetInstanceIds?: string[];
  linkedTargetWorldX?: number | null;
  linkedTargetWorldY?: number | null;
  containedObjectId: string | null;
  signText: string | null;
  objectiveMode?: SwordsmanObjectiveMode | null;
  defeatMode?: SwordsmanDefeatMode | null;
  policeBehaviorMode?: PoliceBehaviorMode | null;
  policePatrolShoots?: boolean | null;
  npcMode?: NpcMode | null;
  npcPushable?: boolean | null;
  npcCanJumpFall?: boolean | null;
  npcPlayerCollision?: boolean | null;
  npcFriendlyFire?: boolean | null;
  npcName?: string | null;
  npcDefeatMode?: SwordsmanDefeatMode | null;
  countsTowardGoals: boolean;
}

export interface WeaponHitResult {
  roomId: string;
  enemyName: string;
  x: number;
  y: number;
}

export type LiveObjectRemovedReason =
  | 'enemy-defeated'
  | 'npc-defeated'
  | 'collectible-collected'
  | 'enemy-collected'
  | 'object-removed'
  | 'brick-broken'
  | 'crate-broken';

export type LiveObjectExplicitRemovalReason = Extract<
  LiveObjectRemovedReason,
  'object-removed' | 'brick-broken' | 'crate-broken'
>;

export interface LiveObjectRemovedEvent {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  objectKey: string;
  objectId: string;
  instanceId: string | null;
  reason: LiveObjectRemovedReason;
  x: number;
  y: number;
}

export interface LiveObjectSwitchStateChangedEvent {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  active: boolean;
}
