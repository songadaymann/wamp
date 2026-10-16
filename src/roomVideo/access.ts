import type { TrustTier } from '../progression/model';
import { normalizeRoomVideo, roomVideosEqual, type RoomVideo } from './model';

const TRUST_RANK: Record<TrustTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
};

export const ROOM_VIDEO_TRUST_MESSAGE = 'Builder trust level 1 is required for a video link.';

export function builderCanUseRoomVideo(tier: TrustTier | null | undefined): boolean {
  return tier != null && TRUST_RANK[tier] >= TRUST_RANK.T1;
}

let rememberedTier: TrustTier | null = null;
const listeners = new Set<() => void>();

export function rememberBuilderTrustTier(tier: TrustTier | null): void {
  if (rememberedTier === tier) return;
  rememberedTier = tier;
  for (const listener of listeners) listener();
}

export function currentBuilderCanUseRoomVideo(): boolean {
  return builderCanUseRoomVideo(rememberedTier);
}

export function watchRoomVideoAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A removed video is always allowed. Keeping the stored video is allowed. A new or edited video needs trust. */
export function roomVideoChangeNeedsTrust(
  incoming: RoomVideo | null | undefined,
  previous: RoomVideo | null | undefined,
): boolean {
  const next = normalizeRoomVideo(incoming);
  if (!next) return false;
  return !roomVideosEqual(next, normalizeRoomVideo(previous));
}
