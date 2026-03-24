import type { RoomVersionRecord } from './roomModel';
import {
  buildRoomVersionLineage,
  type RoomVersionEquivalenceGroup,
  type RoomVersionLineage,
} from './roomVersionLineage';
import { getLeaderboardRankingMode } from '../runs/scoring';

export interface RoomLeaderboardFamily {
  representativeVersion: number;
  versions: number[];
  latestVersion: number;
  hasGoal: boolean;
}

export interface RoomLeaderboardLineageEntry {
  version: number;
  representativeVersion: number;
  equivalentVersions: number[];
  latestEquivalentVersion: number;
  sameAsVersion: number | null;
  isRepresentative: boolean;
  isCanonical: boolean;
  inCanonicalGroup: boolean;
  groupContainsCurrentPublished: boolean;
  hasGoal: boolean;
  leaderboardFamilyVersions: number[];
  latestLeaderboardFamilyVersion: number;
  leaderboardSourceVersion: number | null;
  leaderboardSourceRepresentativeVersion: number | null;
  familyContainsCurrentPublished: boolean;
}

export interface RoomLeaderboardLineage {
  currentPublishedVersion: number | null;
  canonicalVersion: number | null;
  exactLineage: RoomVersionLineage;
  families: RoomLeaderboardFamily[];
  byVersion: Map<number, RoomLeaderboardLineageEntry>;
}

export function buildRoomLeaderboardLineage(
  versions: RoomVersionRecord[],
  canonicalVersion: number | null,
  currentPublishedVersion: number | null = null
): RoomLeaderboardLineage {
  const exactLineage = buildRoomVersionLineage(versions, canonicalVersion, currentPublishedVersion);
  const versionsAscending = [...versions].sort((left, right) => left.version - right.version);
  const groupByRepresentative = new Map<number, RoomVersionEquivalenceGroup>();
  const versionRecordByNumber = new Map<number, RoomVersionRecord>();

  for (const version of versionsAscending) {
    versionRecordByNumber.set(version.version, version);
  }

  for (const group of exactLineage.groups) {
    groupByRepresentative.set(group.representativeVersion, group);
  }

  const edges = new Map<number, Set<number>>();
  for (const group of exactLineage.groups) {
    edges.set(group.representativeVersion, new Set());
  }

  for (const version of versionsAscending) {
    const sourceVersion = version.leaderboardSourceVersion;
    if (sourceVersion === null) {
      continue;
    }

    const targetEntry = exactLineage.byVersion.get(version.version) ?? null;
    const sourceEntry = exactLineage.byVersion.get(sourceVersion) ?? null;
    const sourceRecord = versionRecordByNumber.get(sourceVersion) ?? null;
    if (!targetEntry || !sourceEntry || !sourceRecord) {
      continue;
    }

    const validationError = getManualRoomLeaderboardSourceValidationError(
      version,
      sourceRecord,
      exactLineage
    );
    if (validationError) {
      continue;
    }

    const targetNeighbors = edges.get(targetEntry.representativeVersion);
    const sourceNeighbors = edges.get(sourceEntry.representativeVersion);
    if (!targetNeighbors || !sourceNeighbors) {
      continue;
    }

    targetNeighbors.add(sourceEntry.representativeVersion);
    sourceNeighbors.add(targetEntry.representativeVersion);
  }

  const families: RoomLeaderboardFamily[] = [];
  const familyByRepresentative = new Map<number, RoomLeaderboardFamily>();
  const visitedRepresentatives = new Set<number>();
  const groupRepresentatives = exactLineage.groups
    .map((group) => group.representativeVersion)
    .sort((left, right) => left - right);

  for (const representativeVersion of groupRepresentatives) {
    if (visitedRepresentatives.has(representativeVersion)) {
      continue;
    }

    const stack = [representativeVersion];
    const componentRepresentatives: number[] = [];
    while (stack.length > 0) {
      const next = stack.pop() ?? null;
      if (next === null || visitedRepresentatives.has(next)) {
        continue;
      }

      visitedRepresentatives.add(next);
      componentRepresentatives.push(next);
      const neighbors = edges.get(next);
      if (!neighbors) {
        continue;
      }

      for (const neighbor of neighbors) {
        if (!visitedRepresentatives.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    componentRepresentatives.sort((left, right) => left - right);
    const familyVersions = componentRepresentatives
      .flatMap((componentRepresentative) => groupByRepresentative.get(componentRepresentative)?.versions ?? [])
      .sort((left, right) => left - right);
    const family: RoomLeaderboardFamily = {
      representativeVersion: componentRepresentatives[0] ?? representativeVersion,
      versions: familyVersions,
      latestVersion: familyVersions[familyVersions.length - 1] ?? representativeVersion,
      hasGoal: componentRepresentatives.some(
        (componentRepresentative) => groupByRepresentative.get(componentRepresentative)?.hasGoal ?? false
      ),
    };

    families.push(family);
    for (const componentRepresentative of componentRepresentatives) {
      familyByRepresentative.set(componentRepresentative, family);
    }
  }

  const byVersion = new Map<number, RoomLeaderboardLineageEntry>();
  for (const version of versionsAscending) {
    const exactEntry = exactLineage.byVersion.get(version.version) ?? null;
    if (!exactEntry) {
      continue;
    }

    const family = familyByRepresentative.get(exactEntry.representativeVersion);
    if (!family) {
      continue;
    }

    const rawSourceVersion = version.leaderboardSourceVersion;
    const sourceRecord =
      rawSourceVersion === null ? null : versionRecordByNumber.get(rawSourceVersion) ?? null;
    const sourceVersion =
      sourceRecord !== null &&
      getManualRoomLeaderboardSourceValidationError(version, sourceRecord, exactLineage) === null
        ? rawSourceVersion
        : null;
    const sourceEntry =
      sourceVersion === null ? null : exactLineage.byVersion.get(sourceVersion) ?? null;
    byVersion.set(version.version, {
      version: version.version,
      representativeVersion: exactEntry.representativeVersion,
      equivalentVersions: [...exactEntry.equivalentVersions],
      latestEquivalentVersion: exactEntry.latestEquivalentVersion,
      sameAsVersion: exactEntry.sameAsVersion,
      isRepresentative: exactEntry.isRepresentative,
      isCanonical: exactEntry.isCanonical,
      inCanonicalGroup: exactEntry.inCanonicalGroup,
      groupContainsCurrentPublished: exactEntry.groupContainsCurrentPublished,
      hasGoal: exactEntry.hasGoal,
      leaderboardFamilyVersions: [...family.versions],
      latestLeaderboardFamilyVersion: family.latestVersion,
      leaderboardSourceVersion: sourceVersion,
      leaderboardSourceRepresentativeVersion: sourceEntry?.representativeVersion ?? null,
      familyContainsCurrentPublished:
        currentPublishedVersion !== null && family.versions.includes(currentPublishedVersion),
    });
  }

  return {
    currentPublishedVersion,
    canonicalVersion,
    exactLineage,
    families: families.sort((left, right) => left.representativeVersion - right.representativeVersion),
    byVersion,
  };
}

export function getManualRoomLeaderboardSourceValidationError(
  target: RoomVersionRecord,
  source: RoomVersionRecord,
  exactLineage?: RoomVersionLineage
): string | null {
  if (target.snapshot.id !== source.snapshot.id) {
    return 'Leaderboard adoption is only available within the same room.';
  }

  if (source.version === target.version || source.version > target.version) {
    return 'Pick an older published version as the leaderboard source.';
  }

  if (!target.snapshot.goal || !source.snapshot.goal) {
    return 'Only published challenge versions can share a leaderboard.';
  }

  if (target.snapshot.goal.type !== source.snapshot.goal.type) {
    return 'Only versions with the same goal type can share a leaderboard.';
  }

  if (getLeaderboardRankingMode(target.snapshot.goal) !== getLeaderboardRankingMode(source.snapshot.goal)) {
    return 'Only versions with the same ranking mode can share a leaderboard.';
  }

  const lineage = exactLineage ?? buildRoomVersionLineage([target, source], null, null);
  const targetEntry = lineage.byVersion.get(target.version) ?? null;
  const sourceEntry = lineage.byVersion.get(source.version) ?? null;
  if (
    targetEntry &&
    sourceEntry &&
    targetEntry.representativeVersion === sourceEntry.representativeVersion
  ) {
    return 'This version already shares that leaderboard automatically.';
  }

  return null;
}

export function canVersionAdoptManualLeaderboardSource(
  target: RoomVersionRecord,
  source: RoomVersionRecord,
  exactLineage?: RoomVersionLineage
): boolean {
  return getManualRoomLeaderboardSourceValidationError(target, source, exactLineage) === null;
}
