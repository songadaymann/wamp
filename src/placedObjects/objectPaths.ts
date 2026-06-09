import {
  canPlacedObjectBeLinkedObjectTarget,
  isMovingPlatformObjectId,
  type PlacedObject,
} from '../config';

export const MAX_PLACED_OBJECT_PATH_TARGETS = 12;

type PathTargetSource = Pick<PlacedObject, 'triggerTargetInstanceId' | 'linkedTargetInstanceIds'>;

export function canPlacedObjectUseObjectPath(
  placed: Pick<PlacedObject, 'id'> | null | undefined,
): boolean {
  return Boolean(placed && isMovingPlatformObjectId(placed.id));
}

export function normalizePlacedObjectPathTargetIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const targetId = entry.trim();
    if (!targetId || seen.has(targetId)) {
      continue;
    }

    seen.add(targetId);
    normalized.push(targetId);
    if (normalized.length >= MAX_PLACED_OBJECT_PATH_TARGETS) {
      break;
    }
  }

  return normalized;
}

export function getPlacedObjectPathTargetIds(
  placed: PathTargetSource | null | undefined,
): string[] {
  if (!placed) {
    return [];
  }

  const targetIds = normalizePlacedObjectPathTargetIds(placed.linkedTargetInstanceIds);
  if (targetIds.length > 0) {
    return targetIds;
  }

  return normalizePlacedObjectPathTargetIds([placed.triggerTargetInstanceId]);
}

export function getPlacedObjectPrimaryPathTargetId(
  placed: PathTargetSource | null | undefined,
): string | null {
  return getPlacedObjectPathTargetIds(placed)[0] ?? null;
}

export function withPlacedObjectPathTargets<T extends PlacedObject>(
  placed: T,
  targetInstanceIds: readonly string[],
): T {
  const normalized = normalizePlacedObjectPathTargetIds(targetInstanceIds);
  return {
    ...placed,
    triggerTargetInstanceId: normalized[0] ?? null,
    linkedTargetInstanceIds: canPlacedObjectUseObjectPath(placed) && normalized.length > 0
      ? normalized
      : null,
  };
}

export function validatePlacedObjectPathTargetIds(
  source: PlacedObject,
  candidateTargetInstanceIds: readonly string[],
  resolveTarget: (targetInstanceId: string) => PlacedObject | null,
): string[] {
  if (!canPlacedObjectUseObjectPath(source)) {
    return [];
  }

  const validTargetIds: string[] = [];
  for (const targetInstanceId of normalizePlacedObjectPathTargetIds(candidateTargetInstanceIds)) {
    const target = resolveTarget(targetInstanceId);
    if (
      target &&
      target.instanceId !== source.instanceId &&
      canPlacedObjectBeLinkedObjectTarget(source, target)
    ) {
      validTargetIds.push(target.instanceId);
    }
  }

  return validTargetIds;
}
