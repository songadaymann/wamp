import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import {
  createPublishedRoomSummary,
  isWithinRoomBounds,
  type WorldRoomBounds,
  type WorldRoomSummary,
} from '../../persistence/worldModel';
import type { StreamingRoomCandidate } from './worldStreamingModel';

export interface VisibleRoomCandidateSources {
  roomBounds: WorldRoomBounds | null;
  summaries: Iterable<WorldRoomSummary>;
  draftRooms: Iterable<RoomSnapshot>;
  transientRoomOverrides: Iterable<RoomSnapshot>;
  presencePreviewRooms: Iterable<RoomSnapshot>;
  optimisticPublishedRooms: Iterable<RoomSnapshot>;
}

export function collectVisibleRoomCandidates(
  sources: VisibleRoomCandidateSources,
): Map<string, StreamingRoomCandidate> {
  const candidates = new Map<string, StreamingRoomCandidate>();
  if (!sources.roomBounds) return candidates;

  for (const summary of sources.summaries) {
    candidates.set(summary.id, {
      id: summary.id,
      coordinates: { ...summary.coordinates },
      summary,
      draft: null,
      sharedPreview: null,
      allowFullRoomLoad: summary.state === 'published' || summary.state === 'claimed_unpublished',
      source: summary.state === 'published' ? 'published' : 'saved_construction_draft',
    });
  }

  for (const draftRoom of sources.draftRooms) {
    if (!isWithinRoomBounds(draftRoom.coordinates, sources.roomBounds)) continue;
    const existing = candidates.get(draftRoom.id);
    candidates.set(draftRoom.id, {
      id: draftRoom.id,
      coordinates: { ...draftRoom.coordinates },
      summary: existing?.summary ?? null,
      draft: draftRoom,
      sharedPreview: null,
      allowFullRoomLoad: true,
      source: 'local_draft',
    });
  }

  for (const overrideRoom of sources.transientRoomOverrides) {
    if (!isWithinRoomBounds(overrideRoom.coordinates, sources.roomBounds)) continue;
    const existing = candidates.get(overrideRoom.id);
    candidates.set(overrideRoom.id, {
      id: overrideRoom.id,
      coordinates: { ...overrideRoom.coordinates },
      summary: existing?.summary ?? null,
      draft: overrideRoom,
      sharedPreview: null,
      allowFullRoomLoad: true,
      source: 'local_draft',
    });
  }

  for (const previewRoom of sources.presencePreviewRooms) {
    if (!isWithinRoomBounds(previewRoom.coordinates, sources.roomBounds)) continue;
    const existing = candidates.get(previewRoom.id);
    if (existing?.draft) continue;
    candidates.set(previewRoom.id, {
      id: previewRoom.id,
      coordinates: { ...previewRoom.coordinates },
      summary: existing?.summary ?? null,
      draft: null,
      sharedPreview: previewRoom,
      allowFullRoomLoad:
        existing?.summary?.state === 'claimed_unpublished' ||
        (!existing?.summary && previewRoom.status === 'draft'),
      source: 'live_construction_preview',
    });
  }

  for (const optimisticRoom of sources.optimisticPublishedRooms) {
    if (!isWithinRoomBounds(optimisticRoom.coordinates, sources.roomBounds)) continue;
    const existing = candidates.get(optimisticRoom.id);
    if (existing?.draft || existing?.sharedPreview) continue;
    candidates.set(optimisticRoom.id, {
      id: optimisticRoom.id,
      coordinates: { ...optimisticRoom.coordinates },
      summary: existing?.summary ?? createPublishedRoomSummary(optimisticRoom),
      draft: optimisticRoom,
      sharedPreview: null,
      allowFullRoomLoad: true,
      source: 'published',
    });
  }

  return candidates;
}

export function selectNearestPreviewRoomIds(input: {
  roomCandidates: ReadonlyMap<string, StreamingRoomCandidate>;
  previewRoomIds: ReadonlySet<string>;
  fullRoomIds: ReadonlySet<string>;
  focusCoordinates: RoomCoordinates;
  previewCount: number;
}): Set<string> {
  const sortedPreviewIds = [...input.previewRoomIds].sort((leftId, rightId) => {
    const left = input.roomCandidates.get(leftId)?.coordinates;
    const right = input.roomCandidates.get(rightId)?.coordinates;
    const leftDistance = left
      ? Math.abs(left.x - input.focusCoordinates.x) + Math.abs(left.y - input.focusCoordinates.y)
      : Number.MAX_SAFE_INTEGER;
    const rightDistance = right
      ? Math.abs(right.x - input.focusCoordinates.x) + Math.abs(right.y - input.focusCoordinates.y)
      : Number.MAX_SAFE_INTEGER;
    return leftDistance - rightDistance || leftId.localeCompare(rightId);
  });
  return new Set([...input.fullRoomIds, ...sortedPreviewIds.slice(0, input.previewCount)]);
}

export interface FullRoomRetentionPlan {
  retainedRoomIds: Set<string>;
  releaseAtByRoomId: Map<string, number>;
  nextReleaseAt: number | null;
}

export function planFullRoomRetention(input: {
  targetRoomIds: ReadonlySet<string>;
  protectedRoomIds: ReadonlySet<string>;
  loadedRoomIds: Iterable<string>;
  pendingTeardownRoomIds: ReadonlySet<string>;
  releaseAtByRoomId: ReadonlyMap<string, number>;
  now: number;
  retainReleaseGrace: boolean;
  releaseGraceMs: number;
}): FullRoomRetentionPlan {
  const effectiveTargetRoomIds = new Set(input.targetRoomIds);
  for (const roomId of input.protectedRoomIds) effectiveTargetRoomIds.add(roomId);

  const loadedRoomIds = new Set(input.loadedRoomIds);
  const releaseAtByRoomId = new Map(input.releaseAtByRoomId);
  const retainedRoomIds = new Set(effectiveTargetRoomIds);
  let nextReleaseAt: number | null = null;

  for (const roomId of effectiveTargetRoomIds) releaseAtByRoomId.delete(roomId);
  for (const roomId of releaseAtByRoomId.keys()) {
    if (!loadedRoomIds.has(roomId)) releaseAtByRoomId.delete(roomId);
  }

  for (const roomId of loadedRoomIds) {
    if (effectiveTargetRoomIds.has(roomId) || input.pendingTeardownRoomIds.has(roomId)) continue;
    if (!input.retainReleaseGrace) {
      releaseAtByRoomId.delete(roomId);
      continue;
    }

    const releaseAt = releaseAtByRoomId.get(roomId) ?? (input.now + input.releaseGraceMs);
    releaseAtByRoomId.set(roomId, releaseAt);
    if (releaseAt > input.now) {
      retainedRoomIds.add(roomId);
      nextReleaseAt = nextReleaseAt === null ? releaseAt : Math.min(nextReleaseAt, releaseAt);
    } else {
      releaseAtByRoomId.delete(roomId);
    }
  }

  return { retainedRoomIds, releaseAtByRoomId, nextReleaseAt };
}
