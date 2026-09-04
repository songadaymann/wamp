import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export const WAMP_PRIME_WORLD_ID = 'wamp-prime';
export const WORLD_ORIGIN_SPACING = 129;
export const DEFAULT_WORLD_CLAIM_LIMIT = 5;
export const DEFAULT_WORLD_PUBLISH_LIMIT = 10;
export const COMPLIMENTARY_WORLD_CLAIM_CEILING = 10;
export const COMPLIMENTARY_WORLD_PUBLISH_CEILING = 25;

export type WorldBuildPolicy = 'request_to_join' | 'invite_only';
export type WorldPublishPolicy = 'members_publish' | 'approval_required';
export type WorldEntitlementStatus = 'active' | 'frozen';
export type WorldMembershipRole = 'owner' | 'manager' | 'builder';
export type WorldMembershipStatus =
  | 'invited'
  | 'requested'
  | 'active'
  | 'removed'
  | 'blocked';
export type WorldViewerRole = WorldMembershipRole | null;

export interface WorldSettings {
  buildPolicy: WorldBuildPolicy;
  publishPolicy: WorldPublishPolicy;
  claimLimitPerDay: number;
  publishLimitPerDay: number;
}

export interface WorldSummary {
  id: string;
  number: number;
  displayName: string | null;
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  origin: RoomCoordinates;
  roomCount: number;
  buildPolicy: WorldBuildPolicy;
  publishPolicy: WorldPublishPolicy;
  frozen: boolean;
  sharePath: string;
  viewerRole: WorldViewerRole;
  viewerMembershipStatus: WorldMembershipStatus | null;
}

export interface WorldDetail extends WorldSummary {
  settings: WorldSettings;
  claimLimitCeiling: number;
  publishLimitCeiling: number;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canReviewPublications: boolean;
  canRequestName: boolean;
}

export interface WorldEntitlementSummary {
  id: string;
  status: WorldEntitlementStatus;
  source: 'complimentary' | 'payment_provider';
  provider: string | null;
  worldId: string | null;
  worldNumber: number | null;
  ownerEmail: string;
  claimLimitCeiling: number;
  publishLimitCeiling: number;
  billingInterval: 'month' | 'year' | null;
  currentPeriodEnd: string | null;
  seedDraft: RoomSnapshot | null;
  seedUpdatedAt: string | null;
}

export interface WorldMembership {
  id: string;
  worldId: string;
  userId: string | null;
  email: string;
  displayName: string | null;
  role: WorldMembershipRole;
  status: WorldMembershipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorldPublicationRequest {
  id: string;
  worldId: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  submittedByUserId: string;
  submittedByDisplayName: string | null;
  submittedDraftUpdatedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'stale';
  rejectionReason: string | null;
  submittedAt: string;
  resolvedAt: string | null;
}

export interface WorldNameRequest {
  id: string;
  worldId: string;
  worldNumber: number;
  currentName: string | null;
  proposedName: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  resolvedAt: string | null;
}

export interface WorldActivityEvent {
  id: string;
  worldId: string | null;
  entitlementId: string | null;
  eventType: string;
  subjectId: string | null;
  occurredAt: string;
}

export interface WorldAdminState {
  worlds: WorldSummary[];
  entitlements: WorldEntitlementSummary[];
  pendingNames: WorldNameRequest[];
  recentActivity: WorldActivityEvent[];
}

export interface WorldRoomContext {
  worldId: string;
  worldNumber: number;
  worldName: string | null;
  viewerRole: WorldViewerRole;
  membershipStatus: WorldMembershipStatus | null;
  frozen: boolean;
}

export interface MyWorldsResponse {
  entitlements: WorldEntitlementSummary[];
  worlds: WorldDetail[];
}

export interface WorldEntitlementChange {
  entitlementId: string;
  idempotencyKey: string;
  occurredAt: string;
}

export interface WorldEntitlementProvider {
  activate(change: WorldEntitlementChange): Promise<void>;
  freeze(change: WorldEntitlementChange): Promise<void>;
  reactivate(change: WorldEntitlementChange): Promise<void>;
}
