import type {
  GlobalLeaderboardEntry,
  GlobalLeaderboardResponse,
  RoomLeaderboardEntry,
  RoomLeaderboardResponse,
} from '../runs/model';
import type {
  CourseLeaderboardEntry,
  CourseLeaderboardResponse,
} from '../courses/runModel';
import { isPlayfunLeaderboardExcludedDisplayName } from './identity';
import { isPlayfunMode } from './state';

export function filterRoomLeaderboardForCurrentSurface(
  response: RoomLeaderboardResponse
): RoomLeaderboardResponse {
  if (isPlayfunMode()) {
    return response;
  }

  const entries = reRankVisibleEntries(response.entries);
  const viewerRank = adjustViewerRank(response.entries, response.viewerRank);
  const viewerBest =
    response.viewerBest && !isPlayfunLeaderboardExcludedDisplayName(response.viewerBest.userDisplayName)
      ? {
          ...response.viewerBest,
          rank: entries.find((entry) => entry.attemptId === response.viewerBest?.attemptId)?.rank
            ?? viewerRank
            ?? response.viewerBest.rank,
        }
      : null;

  return {
    ...response,
    entries,
    viewerBest,
    viewerRank: viewerBest ? viewerRank ?? viewerBest.rank : null,
  };
}

export function filterCourseLeaderboardForCurrentSurface(
  response: CourseLeaderboardResponse
): CourseLeaderboardResponse {
  if (isPlayfunMode()) {
    return response;
  }

  const entries = reRankVisibleEntries(response.entries);
  const viewerRank = adjustViewerRank(response.entries, response.viewerRank);
  const viewerBest =
    response.viewerBest && !isPlayfunLeaderboardExcludedDisplayName(response.viewerBest.userDisplayName)
      ? {
          ...response.viewerBest,
          rank: entries.find((entry) => entry.attemptId === response.viewerBest?.attemptId)?.rank
            ?? viewerRank
            ?? response.viewerBest.rank,
        }
      : null;

  return {
    ...response,
    entries,
    viewerBest,
    viewerRank: viewerBest ? viewerRank ?? viewerBest.rank : null,
  };
}

export function filterGlobalLeaderboardForCurrentSurface(
  response: GlobalLeaderboardResponse
): GlobalLeaderboardResponse {
  if (isPlayfunMode()) {
    return response;
  }

  const entries = reRankVisibleEntries(response.entries);
  const viewerRank = adjustViewerRank(response.entries, response.viewerEntry?.rank ?? null);
  const viewerEntry =
    response.viewerEntry && !isPlayfunLeaderboardExcludedDisplayName(response.viewerEntry.userDisplayName)
      ? {
          ...response.viewerEntry,
          rank: entries.find((entry) => entry.userId === response.viewerEntry?.userId)?.rank
            ?? viewerRank
            ?? response.viewerEntry.rank,
        }
      : null;

  return {
    entries,
    viewerEntry,
  };
}

function reRankVisibleEntries<T extends { rank: number; userDisplayName: string }>(entries: T[]): T[] {
  return entries
    .filter((entry) => !isPlayfunLeaderboardExcludedDisplayName(entry.userDisplayName))
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function adjustViewerRank<T extends { rank: number; userDisplayName: string }>(
  entries: T[],
  rank: number | null
): number | null {
  if (!rank || !Number.isFinite(rank) || rank < 1) {
    return null;
  }

  const hiddenAhead = entries.filter(
    (entry) =>
      entry.rank < rank
      && isPlayfunLeaderboardExcludedDisplayName(entry.userDisplayName)
  ).length;

  return Math.max(1, rank - hiddenAhead);
}
