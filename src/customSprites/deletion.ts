export type CustomSpriteDeletionResult =
  | 'deleted'
  | 'in-use'
  | 'not-local'
  | 'verification-failed';

export interface CustomSpriteDeletionDependencies {
  isUsedLocally(spriteId: string): boolean;
  loadRemoteUsage(spriteId: string): Promise<{ inUse: boolean }>;
  removeLocalSprite(spriteId: string): boolean;
}

export async function deleteCustomSpriteIfUnused(
  spriteId: string,
  dependencies: CustomSpriteDeletionDependencies,
): Promise<CustomSpriteDeletionResult> {
  if (dependencies.isUsedLocally(spriteId)) {
    return 'in-use';
  }

  try {
    const usage = await dependencies.loadRemoteUsage(spriteId);
    if (usage.inUse) {
      return 'in-use';
    }
  } catch {
    return 'verification-failed';
  }

  return dependencies.removeLocalSprite(spriteId) ? 'deleted' : 'not-local';
}
