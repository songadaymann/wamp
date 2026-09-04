import type {
  WorldBuildPolicy,
  WorldEntitlementStatus,
  WorldMembershipStatus,
  WorldPublishPolicy,
  WorldViewerRole,
} from './model';

export interface WorldPolicyInput {
  entitlementStatus: WorldEntitlementStatus;
  buildPolicy: WorldBuildPolicy;
  publishPolicy: WorldPublishPolicy;
  viewerRole: WorldViewerRole;
  membershipStatus: WorldMembershipStatus | null;
  isAdmin?: boolean;
}

export interface WorldPolicyDecision {
  canPlay: true;
  canRequestMembership: boolean;
  canEditRooms: boolean;
  canClaimRooms: boolean;
  canPublishDirectly: boolean;
  canSubmitForApproval: boolean;
  canReviewPublications: boolean;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canManageManagers: boolean;
  canRequestName: boolean;
  canManageHistory: boolean;
}

export function resolveWorldPolicy(input: WorldPolicyInput): WorldPolicyDecision {
  const active = input.entitlementStatus === 'active';
  const isOwner = input.viewerRole === 'owner';
  const isManager = input.viewerRole === 'manager';
  const activeMember =
    input.membershipStatus === 'active' &&
    (input.viewerRole === 'builder' || isManager);
  const operationalMember = isOwner || activeMember;
  const moderator = isOwner || isManager;
  const admin = input.isAdmin === true;

  return {
    canPlay: true,
    canRequestMembership:
      active &&
      input.buildPolicy === 'request_to_join' &&
      input.viewerRole === null &&
      input.membershipStatus !== 'blocked',
    canEditRooms: active && (operationalMember || admin),
    canClaimRooms: active && (operationalMember || admin),
    canPublishDirectly:
      active &&
      (admin || moderator || (activeMember && input.publishPolicy === 'members_publish')),
    canSubmitForApproval:
      active && activeMember && !moderator && input.publishPolicy === 'approval_required',
    canReviewPublications: active && (moderator || admin),
    canManageMembers: active && (moderator || admin),
    canManageSettings: active && (isOwner || admin),
    canManageManagers: active && isOwner,
    canRequestName: active && isOwner,
    canManageHistory: active && (moderator || admin),
  };
}
