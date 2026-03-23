import { cloneRoomSnapshot, type RoomRecord, type RoomSnapshot } from '../../../persistence/roomModel';
import { buildRoomVersionLineage } from '../../../persistence/roomVersionLineage';
import { HttpError } from '../core/http';

export interface AggregatedRoomVersionSelection {
  snapshot: RoomSnapshot;
  roomVersion: number;
  displayRoomVersion: number;
  equivalentRoomVersions: number[];
  canonicalRoomVersion: number | null;
  currentPublishedVersion: number | null;
}

export function resolveAggregatedRoomVersionSelection(
  record: RoomRecord,
  requestedVersion: number | null
): AggregatedRoomVersionSelection {
  const currentPublishedVersion = record.published?.version ?? null;
  const lineage = buildRoomVersionLineage(record.versions, record.canonicalVersion, currentPublishedVersion);
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

  return {
    snapshot: resolveSnapshotForVersion(record, effectiveRoomVersion),
    roomVersion: effectiveRoomVersion,
    displayRoomVersion: selectedEntry.representativeVersion,
    equivalentRoomVersions: [...selectedEntry.equivalentVersions],
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
