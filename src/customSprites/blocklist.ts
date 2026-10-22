/**
 * Community sprites an admin blocked (F189). Rooms embed full sprite definitions, so blocking only
 * the catalog entry left the art showing; the draw functions consult this set instead and paint a
 * neutral placeholder, without changing any stored room data, so "Restore to Community" still works.
 */
const blocked = new Set<string>();
const listeners = new Set<(changed: string[]) => void>();

export const BLOCKED_ART_COLOR = '#6f6a63';
let generation = 0;

/** Bumped whenever the list changes, so cached room images can key on it. */
export function getBlockedCustomSpritesGeneration(): number {
  return generation;
}

export function isCustomSpriteBlocked(spriteId: string | null | undefined): boolean {
  return Boolean(spriteId) && blocked.has(spriteId!);
}

export function setBlockedCustomSpriteIds(ids: readonly string[]): void {
  const next = new Set(ids);
  const changed = [...ids.filter((id) => !blocked.has(id)), ...[...blocked].filter((id) => !next.has(id))];
  if (changed.length === 0) return;
  blocked.clear();
  for (const id of next) blocked.add(id);
  generation += 1;
  for (const listener of listeners) listener(changed);
}

export function onBlockedCustomSpritesChanged(listener: (changed: string[]) => void): void {
  listeners.add(listener);
}
