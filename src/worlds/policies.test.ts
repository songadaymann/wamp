import { describe, expect, it } from 'vitest';
import { resolveWorldPolicy } from './policies';

const base = {
  entitlementStatus: 'active' as const,
  buildPolicy: 'request_to_join' as const,
  publishPolicy: 'approval_required' as const,
};

describe('World policy', () => {
  it('keeps every World playable while frozen and blocks every mutation', () => {
    const decision = resolveWorldPolicy({
      ...base,
      entitlementStatus: 'frozen',
      viewerRole: 'owner',
      membershipStatus: 'active',
    });
    expect(decision.canPlay).toBe(true);
    expect(Object.entries(decision).filter(([key]) => key !== 'canPlay').every(([, value]) => !value)).toBe(true);
  });

  it('lets builders edit and submit but not publish under approval policy', () => {
    const decision = resolveWorldPolicy({
      ...base,
      viewerRole: 'builder',
      membershipStatus: 'active',
    });
    expect(decision.canEditRooms).toBe(true);
    expect(decision.canSubmitForApproval).toBe(true);
    expect(decision.canPublishDirectly).toBe(false);
  });

  it('gives managers operational powers but not owner settings', () => {
    const decision = resolveWorldPolicy({
      ...base,
      viewerRole: 'manager',
      membershipStatus: 'active',
    });
    expect(decision.canManageMembers).toBe(true);
    expect(decision.canReviewPublications).toBe(true);
    expect(decision.canManageHistory).toBe(true);
    expect(decision.canManageSettings).toBe(false);
    expect(decision.canRequestName).toBe(false);
  });

  it('allows only eligible outsiders to request membership', () => {
    expect(resolveWorldPolicy({ ...base, viewerRole: null, membershipStatus: null }).canRequestMembership).toBe(true);
    expect(resolveWorldPolicy({ ...base, viewerRole: null, membershipStatus: 'blocked' }).canRequestMembership).toBe(false);
    expect(resolveWorldPolicy({ ...base, buildPolicy: 'invite_only', viewerRole: null, membershipStatus: null }).canRequestMembership).toBe(false);
  });
});
