import type { RoomRecord } from '../../persistence/roomModel';
import {
  buildRoomLeaderboardLineage,
  type RoomLeaderboardLineage,
} from '../../persistence/roomLeaderboardLineage';

export interface RoomLeaderboardVersionOption {
  value: number;
  representativeVersion: number;
  equivalentVersions: number[];
  containsCanonical: boolean;
  containsCurrentPublished: boolean;
  label: string;
}

export interface RoomLeaderboardVersionSelectionState {
  options: RoomLeaderboardVersionOption[];
  defaultValue: number | null;
  currentPublishedVersion: number | null;
  lineage: RoomLeaderboardLineage;
}

export function buildRoomLeaderboardVersionSelectionState(
  record: Pick<RoomRecord, 'versions' | 'published' | 'canonicalVersion'>
): RoomLeaderboardVersionSelectionState {
  const currentPublishedVersion = record.published?.version ?? null;
  const lineage = buildRoomLeaderboardLineage(
    record.versions,
    record.canonicalVersion,
    currentPublishedVersion
  );

  const options = lineage.exactLineage.groups
    .filter((group) => group.hasGoal)
    .map<RoomLeaderboardVersionOption>((group) => {
      const containsCanonical =
        record.canonicalVersion !== null && group.versions.includes(record.canonicalVersion);
      const containsCurrentPublished =
        currentPublishedVersion !== null && group.versions.includes(currentPublishedVersion);
      const value =
        containsCurrentPublished && currentPublishedVersion !== null
          ? currentPublishedVersion
          : group.representativeVersion;

      return {
        value,
        representativeVersion: group.representativeVersion,
        equivalentVersions: [...group.versions],
        containsCanonical,
        containsCurrentPublished,
        label: buildOptionLabel(group.representativeVersion, group.latestVersion, {
          containsCanonical,
          containsCurrentPublished,
          leaderboardSourceVersion:
            lineage.byVersion.get(value)?.leaderboardSourceRepresentativeVersion ?? null,
        }),
      };
    });

  const defaultValue =
    options.find((option: RoomLeaderboardVersionOption) => option.containsCanonical)?.value ??
    options.find((option: RoomLeaderboardVersionOption) => option.containsCurrentPublished)?.value ??
    options[options.length - 1]?.value ??
    null;

  return {
    options,
    defaultValue,
    currentPublishedVersion,
    lineage,
  };
}

function buildOptionLabel(
  representativeVersion: number,
  latestVersion: number,
  options: {
    containsCanonical: boolean;
    containsCurrentPublished: boolean;
    leaderboardSourceVersion: number | null;
  }
): string {
  const parts = [`v${representativeVersion}`];
  if (options.containsCanonical) {
    parts.push('canonical');
  }

  if (latestVersion !== representativeVersion) {
    parts.push(
      options.containsCurrentPublished ? `live as v${latestVersion}` : `also v${latestVersion}`
    );
  }

  if (options.leaderboardSourceVersion !== null) {
    parts.push(`leaderboard from v${options.leaderboardSourceVersion}`);
  }

  return parts.join(' · ');
}
