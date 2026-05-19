import type { RoomCoordinates } from '../persistence/roomModel';
import type { PlayerAnimationState } from '../player/avatar/model';
import type { ProgressionDelta, ProgressionSummary } from '../progression/model';

export const MULTIPLAYER_ARENA_HEARTS = 5;
export const MULTIPLAYER_COUNTDOWN_MS = 4_200;
export const MULTIPLAYER_FINALIZE_DRAW_WINDOW_MS = 350;
export const MULTIPLAYER_RESPAWN_INVULNERABLE_MS = 1_800;

export type MultiplayerModeId = 'arena';
export type MultiplayerModeCategory = 'pvp' | 'cooperative';
export type MultiplayerCameraMode = 'room_fit' | 'free_roam';
export type MultiplayerInstanceStatus = 'waiting' | 'countdown' | 'active' | 'finalizing' | 'complete';
export type MultiplayerHitSource = 'sword' | 'gun' | 'stomp' | 'environment';
export type MultiplayerCombatAction = Extract<MultiplayerHitSource, 'sword' | 'gun'>;
export type MultiplayerResult = 'win' | 'loss' | 'draw';

export interface MultiplayerModeDamageRules {
  playerDamage: boolean;
  enemies: boolean;
  hazards: boolean;
  stomp: boolean;
  sword: boolean;
  gun: boolean;
}

export interface MultiplayerModeCopy {
  inviteKicker: string;
  inviteTitle: string;
  inviteBody: (inviterDisplayName: string) => string;
  countdownKicker: string;
  countdownTitle: string;
  countdownRule: string;
  resultKicker: string;
  createdEvent: string;
  startRuleEvent: string;
  goEvent: string;
  waitingStatus: string;
  inviteSent: (opponentDisplayName: string) => string;
  inviteDeclined: (opponentDisplayName: string) => string;
  opponentRequiresSignin: (opponentDisplayName: string) => string;
  activeStatus: (localHearts: number, opponentHearts: number, opponentDisplayName: string) => string;
}

export interface MultiplayerModeDefinition {
  id: MultiplayerModeId;
  displayName: string;
  category: MultiplayerModeCategory;
  minPlayers: number;
  maxPlayers: number;
  lockToStartRoom: boolean;
  camera: MultiplayerCameraMode;
  startingLives: number;
  countdownMs: number;
  respawnInvulnerableMs: number;
  finalizeDrawWindowMs: number;
  goals: {
    room: boolean;
    course: boolean;
  };
  damage: MultiplayerModeDamageRules;
  copy: MultiplayerModeCopy;
}

export const ARENA_MULTIPLAYER_MODE: MultiplayerModeDefinition = {
  id: 'arena',
  displayName: 'Arena Duel',
  category: 'pvp',
  minPlayers: 2,
  maxPlayers: 2,
  lockToStartRoom: true,
  camera: 'room_fit',
  startingLives: MULTIPLAYER_ARENA_HEARTS,
  countdownMs: MULTIPLAYER_COUNTDOWN_MS,
  respawnInvulnerableMs: MULTIPLAYER_RESPAWN_INVULNERABLE_MS,
  finalizeDrawWindowMs: MULTIPLAYER_FINALIZE_DRAW_WINDOW_MS,
  goals: {
    room: false,
    course: false,
  },
  damage: {
    playerDamage: true,
    enemies: true,
    hazards: true,
    stomp: true,
    sword: true,
    gun: true,
  },
  copy: {
    inviteKicker: 'PVP Challenge',
    inviteTitle: 'Arena Duel',
    inviteBody: (inviterDisplayName) => `${inviterDisplayName} invited you to duel.`,
    countdownKicker: 'PVP Starting',
    countdownTitle: 'Arena Duel',
    countdownRule: 'First to lose all hearts loses!',
    resultKicker: 'Duel Result',
    createdEvent: 'Arena Duel created.',
    startRuleEvent: 'First to lose all hearts loses.',
    goEvent: 'GO!',
    waitingStatus: 'Arena Duel waiting for opponent',
    inviteSent: (opponentDisplayName) => `Duel invite sent to ${opponentDisplayName}.`,
    inviteDeclined: (opponentDisplayName) => `${opponentDisplayName} declined the duel.`,
    opponentRequiresSignin: (opponentDisplayName) =>
      `${opponentDisplayName} needs to sign in for ranked PVP.`,
    activeStatus: (localHearts, opponentHearts, opponentDisplayName) =>
      `Arena Duel ${localHearts}-${opponentHearts} vs ${opponentDisplayName}`,
  },
};

export const MULTIPLAYER_MODE_DEFINITIONS = {
  arena: ARENA_MULTIPLAYER_MODE,
} satisfies Record<MultiplayerModeId, MultiplayerModeDefinition>;

export const MULTIPLAYER_MODE_LIST = Object.values(MULTIPLAYER_MODE_DEFINITIONS);

export function getMultiplayerModeDefinition(mode: MultiplayerModeId): MultiplayerModeDefinition {
  return MULTIPLAYER_MODE_DEFINITIONS[mode];
}

export function isMultiplayerModeId(value: unknown): value is MultiplayerModeId {
  return value === 'arena';
}

export interface MultiplayerParticipantIdentity {
  userId: string;
  displayName: string;
  avatarId: string;
}

export interface MultiplayerParticipantSnapshot extends MultiplayerParticipantIdentity {
  hearts: number;
  connected: boolean;
  invulnerableUntil: number;
  losses: number;
  hits: number;
}

export interface MultiplayerInstanceSnapshot {
  matchId: string;
  mode: MultiplayerModeId;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  status: MultiplayerInstanceStatus;
  participants: MultiplayerParticipantSnapshot[];
  startedAt: number | null;
  countdownEndsAt: number | null;
  finishedAt: number | null;
  winnerUserId: string | null;
  loserUserId: string | null;
  draw: boolean;
  lastEvent: string | null;
}

export interface MultiplayerInviteOffer {
  inviteId: string;
  matchId: string;
  mode: MultiplayerModeId;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  shardId: string;
  inviterConnectionId: string;
  inviter: MultiplayerParticipantIdentity;
  target: MultiplayerParticipantIdentity;
  createdAt: number;
  expiresAt: number;
}

export interface MultiplayerInviteSendMessage {
  type: 'pvp:invite';
  invite: {
    inviteId: string;
    matchId: string;
    mode: MultiplayerModeId;
    roomId: string;
    roomCoordinates: RoomCoordinates;
    targetConnectionId: string;
    target: MultiplayerParticipantIdentity;
    expiresAt: number;
  };
}

export interface MultiplayerInviteAcceptMessage {
  type: 'pvp:invite:accept';
  inviteId: string;
  matchId: string;
  inviterConnectionId: string;
}

export interface MultiplayerInviteDeclineMessage {
  type: 'pvp:invite:decline';
  inviteId: string;
  matchId: string;
  inviterConnectionId: string;
}

export interface MultiplayerInviteOfferMessage {
  type: 'pvp:invite:offer';
  invite: MultiplayerInviteOffer;
}

export interface MultiplayerInviteAcceptedMessage {
  type: 'pvp:invite:accepted';
  inviteId: string;
  matchId: string;
  acceptedBy: MultiplayerParticipantIdentity;
}

export interface MultiplayerInviteDeclinedMessage {
  type: 'pvp:invite:declined';
  inviteId: string;
  matchId: string;
  declinedBy: MultiplayerParticipantIdentity;
}

export type MultiplayerPresenceClientMessage =
  | MultiplayerInviteSendMessage
  | MultiplayerInviteAcceptMessage
  | MultiplayerInviteDeclineMessage;

export type MultiplayerPresenceServerMessage =
  | MultiplayerInviteOfferMessage
  | MultiplayerInviteAcceptedMessage
  | MultiplayerInviteDeclinedMessage;

export interface MultiplayerInstanceConfigureMessage {
  type: 'pvp:match:configure';
  matchId: string;
  mode: MultiplayerModeId;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  participants: MultiplayerParticipantIdentity[];
}

export interface MultiplayerInstanceHitMessage {
  type: 'pvp:match:hit';
  hitId: string;
  targetUserId: string;
  source: Exclude<MultiplayerHitSource, 'environment'>;
}

export interface MultiplayerInstanceSelfDeathMessage {
  type: 'pvp:match:self-death';
  hitId: string;
  source: MultiplayerHitSource;
}

export interface MultiplayerInstanceReceivedHitMessage {
  type: 'pvp:match:received-hit';
  hitId: string;
  attackerUserId: string;
  source: Exclude<MultiplayerHitSource, 'environment'>;
}

export interface MultiplayerInstancePlayerState {
  matchId: string;
  userId: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: -1 | 1;
  animationState: PlayerAnimationState;
  action: MultiplayerCombatAction | null;
  actionUntil: number;
  sequence: number;
  sentAt: number;
}

export interface MultiplayerInstancePlayerStateMessage {
  type: 'pvp:match:player-state';
  state: Omit<MultiplayerInstancePlayerState, 'userId'>;
}

export interface MultiplayerInstanceCombatEvent {
  id: string;
  matchId: string;
  userId: string;
  source: MultiplayerCombatAction;
  x: number;
  y: number;
  facing: -1 | 1;
  startedAt: number;
  durationMs: number;
  effectX: number;
  effectY: number;
  downward: boolean;
  projectile: {
    x: number;
    y: number;
    velocityX: number;
    lifetimeMs: number;
  } | null;
}

export interface MultiplayerInstanceCombatEventMessage {
  type: 'pvp:match:combat-event';
  event: Omit<MultiplayerInstanceCombatEvent, 'userId'>;
}

export type MultiplayerRoomStateEventReason =
  | 'enemy-defeated'
  | 'collectible-collected'
  | 'enemy-collected'
  | 'object-removed'
  | 'brick-broken'
  | 'switch-state';

export interface MultiplayerRoomLiveObjectRemovedEvent {
  id: string;
  matchId: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  kind: 'live-object-removed';
  objectKey: string;
  objectId: string;
  instanceId: string | null;
  reason: Exclude<MultiplayerRoomStateEventReason, 'switch-state'>;
  x: number;
  y: number;
  sentAt: number;
  userId: string;
}

export interface MultiplayerRoomSwitchStateEvent {
  id: string;
  matchId: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  kind: 'room-switch-state';
  active: boolean;
  sentAt: number;
  userId: string;
}

export type MultiplayerRoomStateEvent =
  | MultiplayerRoomLiveObjectRemovedEvent
  | MultiplayerRoomSwitchStateEvent;

export type MultiplayerRoomStateEventPayload =
  | Omit<MultiplayerRoomLiveObjectRemovedEvent, 'userId'>
  | Omit<MultiplayerRoomSwitchStateEvent, 'userId'>;

export interface MultiplayerRoomStateEventMessage {
  type: 'pvp:match:room-state-event';
  event: MultiplayerRoomStateEventPayload;
}

export interface MultiplayerInstanceLeaveMessage {
  type: 'pvp:match:leave';
}

export type MultiplayerInstanceClientMessage =
  | MultiplayerInstanceConfigureMessage
  | MultiplayerInstanceHitMessage
  | MultiplayerInstanceSelfDeathMessage
  | MultiplayerInstanceReceivedHitMessage
  | MultiplayerInstancePlayerStateMessage
  | MultiplayerInstanceCombatEventMessage
  | MultiplayerRoomStateEventMessage
  | MultiplayerInstanceLeaveMessage;

export interface MultiplayerInstanceSnapshotMessage {
  type: 'pvp:match:snapshot';
  snapshot: MultiplayerInstanceSnapshot;
}

export interface MultiplayerInstancePeerStateMessage {
  type: 'pvp:match:peer-state';
  state: MultiplayerInstancePlayerState;
}

export interface MultiplayerInstancePeerCombatEventMessage {
  type: 'pvp:match:peer-combat-event';
  event: MultiplayerInstanceCombatEvent;
}

export interface MultiplayerInstancePeerRoomStateEventMessage {
  type: 'pvp:match:peer-room-state-event';
  event: MultiplayerRoomStateEvent;
}

export type MultiplayerInstanceServerMessage =
  | MultiplayerInstanceSnapshotMessage
  | MultiplayerInstancePeerStateMessage
  | MultiplayerInstancePeerCombatEventMessage
  | MultiplayerInstancePeerRoomStateEventMessage;

export interface MultiplayerMatchSubmissionParticipant {
  userId: string;
  userDisplayName: string;
  result: MultiplayerResult;
  heartsRemaining: number;
  livesLost: number;
  hits: number;
}

export interface MultiplayerMatchSubmissionRequestBody {
  matchId: string;
  mode: MultiplayerModeId;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: 'win' | 'draw';
  winnerUserId: string | null;
  loserUserId: string | null;
  participants: MultiplayerMatchSubmissionParticipant[];
  finalSnapshot: MultiplayerInstanceSnapshot;
}

export interface MultiplayerMatchSubmissionResponse {
  saved: boolean;
  matchId: string;
  progressionDelta: ProgressionDelta;
  progression: ProgressionSummary;
}
