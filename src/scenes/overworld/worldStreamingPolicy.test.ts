import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { createPublishedRoomSummary, type WorldRoomSummary } from '../../persistence/worldModel';
import {
  collectVisibleRoomCandidates,
  planFullRoomRetention,
  selectNearestPreviewRoomIds,
} from './worldStreamingPolicy';

describe('world streaming policy', () => {
  it('preserves candidate source precedence and filters non-summary sources to loaded bounds', () => {
    const published = room('1,1', 1, 1, 'published');
    const draft = room('1,1', 1, 1, 'draft');
    const transient = room('1,1', 1, 1, 'draft');
    const previewOverDraft = room('1,1', 1, 1, 'draft');
    const preview = room('2,1', 2, 1, 'draft');
    const optimisticOverPreview = room('2,1', 2, 1, 'published');
    const optimistic = room('3,1', 3, 1, 'published');
    const outside = room('9,9', 9, 9, 'draft');

    const candidates = collectVisibleRoomCandidates({
      roomBounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
      summaries: [createPublishedRoomSummary(published)],
      draftRooms: [draft, outside],
      transientRoomOverrides: [transient],
      presencePreviewRooms: [previewOverDraft, preview],
      optimisticPublishedRooms: [optimisticOverPreview, optimistic],
    });

    expect(candidates.has(outside.id)).toBe(false);
    expect(candidates.get('1,1')).toMatchObject({
      draft: transient,
      sharedPreview: null,
      source: 'local_draft',
    });
    expect(candidates.get('2,1')).toMatchObject({
      draft: null,
      sharedPreview: preview,
      source: 'live_construction_preview',
    });
    expect(candidates.get('3,1')).toMatchObject({
      draft: optimistic,
      source: 'published',
      allowFullRoomLoad: true,
    });
  });

  it('preserves summary state semantics for saved drafts and live previews', () => {
    const claimed = summary('4,4', 4, 4, 'claimed_unpublished');
    const claimedPreview = room('4,4', 4, 4, 'draft');
    const unpublished = summary('5,4', 5, 4, 'frontier');
    const unpublishedPreview = room('5,4', 5, 4, 'draft');

    const candidates = collectVisibleRoomCandidates({
      roomBounds: { minX: 0, maxX: 8, minY: 0, maxY: 8 },
      summaries: [claimed, unpublished],
      draftRooms: [],
      transientRoomOverrides: [],
      presencePreviewRooms: [claimedPreview, unpublishedPreview],
      optimisticPublishedRooms: [],
    });

    expect(candidates.get(claimed.id)).toMatchObject({
      sharedPreview: claimedPreview,
      allowFullRoomLoad: true,
      source: 'live_construction_preview',
    });
    expect(candidates.get(unpublished.id)).toMatchObject({
      sharedPreview: unpublishedPreview,
      allowFullRoomLoad: false,
    });
  });

  it('selects nearest previews deterministically while always retaining full rooms', () => {
    const candidates = collectVisibleRoomCandidates({
      roomBounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      summaries: [
        summary('0,0', 0, 0, 'published'),
        summary('-1,0', -1, 0, 'published'),
        summary('0,-1', 0, -1, 'published'),
        summary('2,0', 2, 0, 'published'),
      ],
      draftRooms: [],
      transientRoomOverrides: [],
      presencePreviewRooms: [],
      optimisticPublishedRooms: [],
    });

    expect(selectNearestPreviewRoomIds({
      roomCandidates: candidates,
      previewRoomIds: new Set(['2,0', '-1,0', '0,-1']),
      fullRoomIds: new Set(['0,0']),
      focusCoordinates: { x: 0, y: 0 },
      previewCount: 2,
    })).toEqual(new Set(['0,0', '-1,0', '0,-1']));
  });

  it('plans release grace without mutating its input and caps cleanup at the earliest deadline', () => {
    const existingReleases = new Map([['stale', 900], ['gone', 2_000]]);
    const plan = planFullRoomRetention({
      targetRoomIds: new Set(['current']),
      protectedRoomIds: new Set(['portal']),
      loadedRoomIds: ['current', 'portal', 'stale', 'fresh'],
      pendingTeardownRoomIds: new Set(),
      releaseAtByRoomId: existingReleases,
      now: 800,
      retainReleaseGrace: true,
      releaseGraceMs: 300,
    });

    expect(plan.retainedRoomIds).toEqual(new Set(['current', 'portal', 'stale', 'fresh']));
    expect(plan.releaseAtByRoomId).toEqual(new Map([['stale', 900], ['fresh', 1_100]]));
    expect(plan.nextReleaseAt).toBe(900);
    expect(existingReleases).toEqual(new Map([['stale', 900], ['gone', 2_000]]));

    const expired = planFullRoomRetention({
      targetRoomIds: new Set(['current']),
      protectedRoomIds: new Set(),
      loadedRoomIds: ['current', 'stale'],
      pendingTeardownRoomIds: new Set(),
      releaseAtByRoomId: plan.releaseAtByRoomId,
      now: 901,
      retainReleaseGrace: true,
      releaseGraceMs: 300,
    });
    expect(expired.retainedRoomIds).toEqual(new Set(['current']));
    expect(expired.releaseAtByRoomId.has('stale')).toBe(false);
  });

  it('removes grace immediately in reduced runtime mode and ignores pending teardowns', () => {
    const plan = planFullRoomRetention({
      targetRoomIds: new Set(['current']),
      protectedRoomIds: new Set(),
      loadedRoomIds: ['current', 'old', 'tearing-down'],
      pendingTeardownRoomIds: new Set(['tearing-down']),
      releaseAtByRoomId: new Map([['old', 5_000], ['tearing-down', 5_000]]),
      now: 1_000,
      retainReleaseGrace: false,
      releaseGraceMs: 300,
    });

    expect(plan.retainedRoomIds).toEqual(new Set(['current']));
    expect(plan.releaseAtByRoomId).toEqual(new Map([['tearing-down', 5_000]]));
    expect(plan.nextReleaseAt).toBeNull();
  });
});

function room(
  id: string,
  x: number,
  y: number,
  status: 'draft' | 'published',
) {
  const snapshot = createDefaultRoomSnapshot(id, { x, y });
  snapshot.status = status;
  return snapshot;
}

function summary(
  id: string,
  x: number,
  y: number,
  state: WorldRoomSummary['state'],
): WorldRoomSummary {
  return {
    id,
    coordinates: { x, y },
    title: null,
    state,
    background: null,
    goalType: null,
    version: state === 'published' ? 1 : null,
    publishedAt: state === 'published' ? '2026-08-13T00:00:00.000Z' : null,
    previewUpdatedAt: null,
    creatorUserId: null,
    creatorDisplayName: null,
    publishedByUserId: null,
    publishedByDisplayName: null,
    course: null,
    expandedRoom: null,
  };
}
