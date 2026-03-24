import { cloneRoomSnapshot, type RoomRecord, type RoomSnapshot } from '../../../persistence/roomModel';
import { buildRoomLeaderboardLineage } from '../../../persistence/roomLeaderboardLineage';
import { HttpError } from '../core/http';

export interface AggregatedRoomLeaderboardSelection {
  snapshot: RoomSnapshot;
  roomVersion: number;
  displayRoomVersion: number;
  equivalentRoomVersions: number[];
  leaderboardFamilyVersions: number[];
  leaderboardSourceVersion: number | null;
  canonicalRoomVersion: number | null;
  currentPublishedVersion: number | null;
}

export function resolveAggregatedRoomLeaderboardSelection(
  record: RoomRecord,
  requestedVersion: number | null
): AggregatedRoomLeaderboardSelection {
  const currentPublishedVersion = record.published?.version ?? null;
  const lineage = buildRoomLeaderboardLineage(record.versions, record.canonicalVersion, currentPublishedVersion);
  const fallbackVersion = currentPublishedVersion ?? null;
  const selectedVersion = requestedVersion ?? fallbackVersion;

  if (selectedVersion === null) {
    throw new HttpError(404, 'Published room version not found.');
  }

  const selectedEntry = lineage.byVersion.get(selectedVersion) ?? null;
  if (!selectedEntry) {
    throw new HttpError(404, `Room version ${selectedVersion} was not found.`);
  }

  const effectiveRoomVersion =
    selectedEntry.groupContainsCurrentPublished && currentPublishedVersion !== null
      ? currentPublishedVersion
      : selectedVersion;
  const effectiveEntry = lineage.byVersion.get(effectiveRoomVersion) ?? null;
  if (!effectiveEntry) {
    throw new HttpError(404, `Room version ${effectiveRoomVersion} was not found.`);
  }

  return {
    snapshot: resolveSnapshotForVersion(record, effectiveRoomVersion),
    roomVersion: effectiveRoomVersion,
    displayRoomVersion: effectiveEntry.representativeVersion,
    equivalentRoomVersions: [...effectiveEntry.equivalentVersions],
    leaderboardFamilyVersions: [...effectiveEntry.leaderboardFamilyVersions],
    leaderboardSourceVersion: effectiveEntry.leaderboardSourceRepresentativeVersion,
    canonicalRoomVersion: record.canonicalVersion,
    currentPublishedVersion,
  };
}

function resolveSnapshotForVersion(record: RoomRecord, version: number): RoomSnapshot {
  if (record.published?.version === version) {
    return cloneRoomSnapshot(record.published);
  }

  const historicalVersion = record.versions.find((candidate) => candidate.version === version) ?? null;
  if (!historicalVersion) {
    throw new HttpError(404, `Room version ${version} was not found.`);
  }

  return cloneRoomSnapshot(historicalVersion.snapshot);
}
