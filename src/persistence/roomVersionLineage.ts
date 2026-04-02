import {
  LAYER_NAMES,
  getPlacedObjectInstanceId,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../config';
import { normalizeRoomGoal, type RoomGoal } from '../goals/roomGoals';
import {
  ROOM_BOUNDARY_SIDES,
  normalizeRoomBoundaryIngressSettings,
  type RoomBoundaryIngressSettings,
  type RoomSnapshot,
  type RoomVersionRecord,
} from './roomModel';

type CanonicalGoalPayload =
  | {
      type: 'reach_exit';
      exit: [number, number] | null;
      timeLimitMs: number | null;
    }
  | {
      type: 'collect_target';
      requiredCount: number;
      timeLimitMs: number | null;
    }
  | {
      type: 'defeat_all';
      timeLimitMs: number | null;
    }
  | {
      type: 'checkpoint_sprint';
      checkpoints: Array<[number, number]>;
      finish: [number, number] | null;
      timeLimitMs: number | null;
    }
  | {
      type: 'survival';
      durationMs: number;
    };

type CanonicalPlacedObjectPayload = {
  id: string;
  x: number;
  y: number;
  layer: LayerName;
  facing: 'left' | 'right' | 'none';
  containedObjectId: string | null;
  triggerTarget: string | null;
};

type CanonicalRoomFingerprintPayload = {
  boundaryIngress: Record<string, [boolean, boolean]>;
  goal: CanonicalGoalPayload | null;
  spawnPoint: [number, number] | null;
  tileData: Record<LayerName, number[]>;
  placedObjects: CanonicalPlacedObjectPayload[];
};

export interface RoomVersionEquivalenceGroup {
  representativeVersion: number;
  versions: number[];
  latestVersion: number;
  hasGoal: boolean;
}

export interface RoomVersionLineageEntry {
  version: number;
  fingerprint: string;
  representativeVersion: number;
  equivalentVersions: number[];
  latestEquivalentVersion: number;
  sameAsVersion: number | null;
  isRepresentative: boolean;
  isCanonical: boolean;
  inCanonicalGroup: boolean;
  groupContainsCurrentPublished: boolean;
  hasGoal: boolean;
}

export interface RoomVersionLineage {
  currentPublishedVersion: number | null;
  canonicalVersion: number | null;
  canonicalRepresentativeVersion: number | null;
  groups: RoomVersionEquivalenceGroup[];
  byVersion: Map<number, RoomVersionLineageEntry>;
}

export function buildRoomVersionFingerprint(snapshot: RoomSnapshot): string {
  const payload: CanonicalRoomFingerprintPayload = {
    boundaryIngress: normalizeBoundaryIngressForFingerprint(snapshot.boundaryIngress),
    goal: normalizeGoalForFingerprint(snapshot.goal),
    spawnPoint: snapshot.spawnPoint
      ? [Math.round(snapshot.spawnPoint.x), Math.round(snapshot.spawnPoint.y)]
      : null,
    tileData: buildTileFingerprint(snapshot),
    placedObjects: buildPlacedObjectFingerprint(snapshot.placedObjects),
  };

  return JSON.stringify(payload);
}

export function buildRoomVersionLineage(
  versions: RoomVersionRecord[],
  canonicalVersion: number | null,
  currentPublishedVersion: number | null = null
): RoomVersionLineage {
  const versionsAscending = [...versions].sort((left, right) => left.version - right.version);
  const versionsByFingerprint = new Map<string, RoomVersionRecord[]>();

  for (const version of versionsAscending) {
    const fingerprint = buildRoomVersionFingerprint(version.snapshot);
    const bucket = versionsByFingerprint.get(fingerprint);
    if (bucket) {
      bucket.push(version);
    } else {
      versionsByFingerprint.set(fingerprint, [version]);
    }
  }

  const groups = Array.from(versionsByFingerprint.entries())
    .map<RoomVersionEquivalenceGroup>(([, bucket]) => {
      const sortedVersions = bucket.map((entry) => entry.version).sort((left, right) => left - right);
      const representativeVersion = sortedVersions[0] ?? 0;
      const latestVersion = sortedVersions[sortedVersions.length - 1] ?? representativeVersion;
      const representativeRecord = bucket.find((entry) => entry.version === representativeVersion) ?? bucket[0];

      return {
        representativeVersion,
        versions: sortedVersions,
        latestVersion,
        hasGoal: representativeRecord?.snapshot.goal !== null,
      };
    })
    .sort((left, right) => left.representativeVersion - right.representativeVersion);

  const canonicalGroup =
    canonicalVersion === null
      ? null
      : groups.find((group) => group.versions.includes(canonicalVersion)) ?? null;
  const canonicalRepresentativeVersion = canonicalGroup?.representativeVersion ?? null;
  const groupByVersion = new Map<number, RoomVersionEquivalenceGroup>();
  const fingerprintByVersion = new Map<number, string>();

  for (const [fingerprint, bucket] of versionsByFingerprint.entries()) {
    const group =
      groups.find((entry) => entry.versions.includes(bucket[0]?.version ?? Number.NaN)) ?? null;
    if (!group) {
      continue;
    }

    for (const version of bucket) {
      groupByVersion.set(version.version, group);
      fingerprintByVersion.set(version.version, fingerprint);
    }
  }

  const byVersion = new Map<number, RoomVersionLineageEntry>();
  for (const version of versionsAscending) {
    const group = groupByVersion.get(version.version);
    if (!group) {
      continue;
    }

    byVersion.set(version.version, {
      version: version.version,
      fingerprint: fingerprintByVersion.get(version.version) ?? '',
      representativeVersion: group.representativeVersion,
      equivalentVersions: [...group.versions],
      latestEquivalentVersion: group.latestVersion,
      sameAsVersion: version.version === group.representativeVersion ? null : group.representativeVersion,
      isRepresentative: version.version === group.representativeVersion,
      isCanonical: canonicalVersion === version.version,
      inCanonicalGroup:
        canonicalRepresentativeVersion !== null &&
        canonicalRepresentativeVersion === group.representativeVersion,
      groupContainsCurrentPublished:
        currentPublishedVersion !== null && group.versions.includes(currentPublishedVersion),
      hasGoal: group.hasGoal,
    });
  }

  return {
    currentPublishedVersion,
    canonicalVersion,
    canonicalRepresentativeVersion,
    groups,
    byVersion,
  };
}

function buildTileFingerprint(snapshot: RoomSnapshot): Record<LayerName, number[]> {
  const tileData = {} as Record<LayerName, number[]>;
  for (const layerName of LAYER_NAMES) {
    tileData[layerName] = snapshot.tileData[layerName].flat().map((value) => Number(value));
  }
  return tileData;
}

function normalizeBoundaryIngressForFingerprint(
  boundaryIngress: RoomBoundaryIngressSettings
): Record<string, [boolean, boolean]> {
  const normalized = normalizeRoomBoundaryIngressSettings(boundaryIngress);
  const payload: Record<string, [boolean, boolean]> = {};
  for (const side of ROOM_BOUNDARY_SIDES) {
    payload[side] = [
      normalized[side].allowObjectsIn,
      normalized[side].allowEnemiesIn,
    ];
  }
  return payload;
}

function normalizeGoalForFingerprint(goal: RoomGoal | null): CanonicalGoalPayload | null {
  const normalized = normalizeRoomGoal(goal);
  if (!normalized) {
    return null;
  }

  switch (normalized.type) {
    case 'reach_exit':
      return {
        type: normalized.type,
        exit: normalized.exit ? [Math.round(normalized.exit.x), Math.round(normalized.exit.y)] : null,
        timeLimitMs: normalized.timeLimitMs,
      };
    case 'collect_target':
      return {
        type: normalized.type,
        requiredCount: normalized.requiredCount,
        timeLimitMs: normalized.timeLimitMs,
      };
    case 'defeat_all':
      return {
        type: normalized.type,
        timeLimitMs: normalized.timeLimitMs,
      };
    case 'checkpoint_sprint':
      return {
        type: normalized.type,
        checkpoints: normalized.checkpoints.map((checkpoint) => [
          Math.round(checkpoint.x),
          Math.round(checkpoint.y),
        ]),
        finish: normalized.finish
          ? [Math.round(normalized.finish.x), Math.round(normalized.finish.y)]
          : null,
        timeLimitMs: normalized.timeLimitMs,
      };
    case 'survival':
      return {
        type: normalized.type,
        durationMs: normalized.durationMs,
      };
  }
}

function buildPlacedObjectFingerprint(placedObjects: PlacedObject[]): CanonicalPlacedObjectPayload[] {
  const normalized = placedObjects.map((placed, index) => {
    const facing: CanonicalPlacedObjectPayload['facing'] =
      placed.facing === 'left' || placed.facing === 'right' ? placed.facing : 'none';
    const signature = buildPlacedObjectSignature(placed);
    return {
      containedObjectId:
        typeof placed.containedObjectId === 'string' && placed.containedObjectId.trim().length > 0
          ? placed.containedObjectId
          : null,
      facing,
      id: placed.id,
      instanceId: getPlacedObjectInstanceId(placed, index),
      layer: getPlacedObjectLayer(placed),
      signature,
      triggerTargetInstanceId:
        typeof placed.triggerTargetInstanceId === 'string' && placed.triggerTargetInstanceId.trim().length > 0
          ? placed.triggerTargetInstanceId
          : null,
      x: Math.round(placed.x),
      y: Math.round(placed.y),
    };
  });

  const normalizedSorted = [...normalized].sort(compareNormalizedPlacedObjects);
  const canonicalIdentityByInstanceId = new Map<string, string>();
  const signatureCounts = new Map<string, number>();
  for (const placed of normalizedSorted) {
    const nextIndex = (signatureCounts.get(placed.signature) ?? 0) + 1;
    signatureCounts.set(placed.signature, nextIndex);
    canonicalIdentityByInstanceId.set(placed.instanceId, `${placed.signature}#${nextIndex}`);
  }

  return normalized
    .map<CanonicalPlacedObjectPayload>((placed) => ({
      id: placed.id,
      x: placed.x,
      y: placed.y,
      layer: placed.layer,
      facing: placed.facing,
      containedObjectId: placed.containedObjectId,
      triggerTarget: placed.triggerTargetInstanceId
        ? canonicalIdentityByInstanceId.get(placed.triggerTargetInstanceId) ?? null
        : null,
    }))
    .sort(compareCanonicalPlacedObjects);
}

function buildPlacedObjectSignature(placed: PlacedObject): string {
  const facing: CanonicalPlacedObjectPayload['facing'] =
    placed.facing === 'left' || placed.facing === 'right' ? placed.facing : 'none';
  return JSON.stringify({
    id: placed.id,
    x: Math.round(placed.x),
    y: Math.round(placed.y),
    layer: getPlacedObjectLayer(placed),
    facing,
    containedObjectId:
      typeof placed.containedObjectId === 'string' && placed.containedObjectId.trim().length > 0
        ? placed.containedObjectId
        : null,
  });
}

function compareCanonicalPlacedObjects(
  left: CanonicalPlacedObjectPayload,
  right: CanonicalPlacedObjectPayload
): number {
  return (
    left.x - right.x ||
    left.y - right.y ||
    left.id.localeCompare(right.id) ||
    left.layer.localeCompare(right.layer) ||
    left.facing.localeCompare(right.facing) ||
    (left.containedObjectId ?? '').localeCompare(right.containedObjectId ?? '') ||
    (left.triggerTarget ?? '').localeCompare(right.triggerTarget ?? '')
  );
}

function compareNormalizedPlacedObjects(
  left: {
    id: string;
    x: number;
    y: number;
    layer: LayerName;
    facing: CanonicalPlacedObjectPayload['facing'];
    containedObjectId: string | null;
    signature: string;
  },
  right: {
    id: string;
    x: number;
    y: number;
    layer: LayerName;
    facing: CanonicalPlacedObjectPayload['facing'];
    containedObjectId: string | null;
    signature: string;
  }
): number {
  return (
    left.signature.localeCompare(right.signature) ||
    left.x - right.x ||
    left.y - right.y ||
    left.id.localeCompare(right.id) ||
    left.layer.localeCompare(right.layer) ||
    left.facing.localeCompare(right.facing) ||
    (left.containedObjectId ?? '').localeCompare(right.containedObjectId ?? '')
  );
}
