import type { RoomCoordinates } from '../persistence/roomModel';
import type { PlayerAnimationState } from '../player/avatar/model';
import type { ProgressionDelta, ProgressionSummary } from '../progression/model';

export const PVP_ARENA_HEARTS = 5;
export const PVP_COUNTDOWN_MS = 4_200;
export const PVP_FINALIZE_DRAW_WINDOW_MS = 350;
export const PVP_RESPAWN_INVULNERABLE_MS = 1_800;

export type PvpMode = 'arena';
export type PvpMatchStatus = 'waiting' | 'countdown' | 'active' | 'finalizing' | 'complete';
export type PvpHitSource = 'sword' | 'gun' | 'stomp' | 'environment';
export type PvpCombatAction = Extract<PvpHitSource, 'sword' | 'gun'>;
export type PvpResult = 'win' | 'loss' | 'draw';

export interface PvpParticipantIdentity {
  userId: string;
  displayName: string;
  avatarId: string;
}

export interface PvpParticipantSnapshot extends PvpParticipantIdentity {
  hearts: number;
  connected: boolean;
  invulnerableUntil: number;
  losses: number;
  hits: number;
}

export interface PvpMatchSnapshot {
  matchId: string;
  mode: PvpMode;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  status: PvpMatchStatus;
  participants: PvpParticipantSnapshot[];
  startedAt: number | null;
  countdownEndsAt: number | null;
  finishedAt: number | null;
  winnerUserId: string | null;
  loserUserId: string | null;
  draw: boolean;
  lastEvent: string | null;
}

export interface PvpInviteOffer {
  inviteId: string;
  matchId: string;
  mode: PvpMode;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  shardId: string;
  inviterConnectionId: string;
  inviter: PvpParticipantIdentity;
  target: PvpParticipantIdentity;
  createdAt: number;
  expiresAt: number;
}

export interface PvpInviteSendMessage {
  type: 'pvp:invite';
  invite: {
    inviteId: string;
    matchId: string;
    mode: PvpMode;
    roomId: string;
    roomCoordinates: RoomCoordinates;
    targetConnectionId: string;
    target: PvpParticipantIdentity;
    expiresAt: number;
  };
}

export interface PvpInviteAcceptMessage {
  type: 'pvp:invite:accept';
  inviteId: string;
  matchId: string;
  inviterConnectionId: string;
}

export interface PvpInviteDeclineMessage {
  type: 'pvp:invite:decline';
  inviteId: string;
  matchId: string;
  inviterConnectionId: string;
}

export interface PvpInviteOfferMessage {
  type: 'pvp:invite:offer';
  invite: PvpInviteOffer;
}

export interface PvpInviteAcceptedMessage {
  type: 'pvp:invite:accepted';
  inviteId: string;
  matchId: string;
  acceptedBy: PvpParticipantIdentity;
}

export interface PvpInviteDeclinedMessage {
  type: 'pvp:invite:declined';
  inviteId: string;
  matchId: string;
  declinedBy: PvpParticipantIdentity;
}

export type PvpPresenceClientMessage =
  | PvpInviteSendMessage
  | PvpInviteAcceptMessage
  | PvpInviteDeclineMessage;

export type PvpPresenceServerMessage =
  | PvpInviteOfferMessage
  | PvpInviteAcceptedMessage
  | PvpInviteDeclinedMessage;

export interface PvpMatchConfigureMessage {
  type: 'pvp:match:configure';
  matchId: string;
  mode: PvpMode;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  participants: PvpParticipantIdentity[];
}

export interface PvpMatchHitMessage {
  type: 'pvp:match:hit';
  hitId: string;
  targetUserId: string;
  source: Exclude<PvpHitSource, 'environment'>;
}

export interface PvpMatchSelfDeathMessage {
  type: 'pvp:match:self-death';
  hitId: string;
  source: PvpHitSource;
}

export interface PvpMatchReceivedHitMessage {
  type: 'pvp:match:received-hit';
  hitId: string;
  attackerUserId: string;
  source: Exclude<PvpHitSource, 'environment'>;
}

export interface PvpMatchPlayerState {
  matchId: string;
  userId: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: -1 | 1;
  animationState: PlayerAnimationState;
  action: PvpCombatAction | null;
  actionUntil: number;
  sequence: number;
  sentAt: number;
}

export interface PvpMatchPlayerStateMessage {
  type: 'pvp:match:player-state';
  state: Omit<PvpMatchPlayerState, 'userId'>;
}

export interface PvpMatchCombatEvent {
  id: string;
  matchId: string;
  userId: string;
  source: PvpCombatAction;
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

export interface PvpMatchCombatEventMessage {
  type: 'pvp:match:combat-event';
  event: Omit<PvpMatchCombatEvent, 'userId'>;
}

export interface PvpMatchLeaveMessage {
  type: 'pvp:match:leave';
}

export type PvpMatchClientMessage =
  | PvpMatchConfigureMessage
  | PvpMatchHitMessage
  | PvpMatchSelfDeathMessage
  | PvpMatchReceivedHitMessage
  | PvpMatchPlayerStateMessage
  | PvpMatchCombatEventMessage
  | PvpMatchLeaveMessage;

export interface PvpMatchSnapshotMessage {
  type: 'pvp:match:snapshot';
  snapshot: PvpMatchSnapshot;
}

export interface PvpMatchPeerStateMessage {
  type: 'pvp:match:peer-state';
  state: PvpMatchPlayerState;
}

export interface PvpMatchPeerCombatEventMessage {
  type: 'pvp:match:peer-combat-event';
  event: PvpMatchCombatEvent;
}

export type PvpMatchServerMessage =
  | PvpMatchSnapshotMessage
  | PvpMatchPeerStateMessage
  | PvpMatchPeerCombatEventMessage;

export interface PvpMatchSubmissionParticipant {
  userId: string;
  userDisplayName: string;
  result: PvpResult;
  heartsRemaining: number;
  livesLost: number;
  hits: number;
}

export interface PvpMatchSubmissionRequestBody {
  matchId: string;
  mode: PvpMode;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: 'win' | 'draw';
  winnerUserId: string | null;
  loserUserId: string | null;
  participants: PvpMatchSubmissionParticipant[];
  finalSnapshot: PvpMatchSnapshot;
}

export interface PvpMatchSubmissionResponse {
  saved: boolean;
  matchId: string;
  progressionDelta: ProgressionDelta;
  progression: ProgressionSummary;
}
