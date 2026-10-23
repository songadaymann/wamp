import type { RoomSnapshot } from '../persistence/roomModel';
import { BLOCKED_ART_COLOR } from './blocklist';

/**
 * Server-side copy of the same rule for baked images (map tiles, share images) and for rooms served
 * to players (Wamp-O-Grams): embedded sprites that are blocked are marked so renderers skip them and
 * have their pixels replaced, so the art is not sent at all, and tiles made from them become a flat
 * placeholder. Returns the snapshot unchanged when nothing in it is blocked.
 */
export function maskBlockedCustomArt(snapshot: RoomSnapshot, blocked: ReadonlySet<string>): RoomSnapshot {
  if (blocked.size === 0) return snapshot;
  const sprites = snapshot.customSprites ?? [];
  const tiles = snapshot.customTiles ?? [];
  const touchesSprites = sprites.some((sprite) => blocked.has(sprite.id));
  const touchesTiles = tiles.some((tile) => tile.sourceSpriteId && blocked.has(tile.sourceSpriteId));
  if (!touchesSprites && !touchesTiles) return snapshot;
  return {
    ...snapshot,
    customSprites: sprites.map((sprite) => (blocked.has(sprite.id)
      ? { ...sprite, status: 'blocked' as const, pixels: sprite.pixels.map(() => BLOCKED_ART_COLOR) }
      : sprite)),
    customTiles: tiles.map((tile) => (tile.sourceSpriteId && blocked.has(tile.sourceSpriteId)
      ? { ...tile, pixels: tile.pixels.map(() => BLOCKED_ART_COLOR) }
      : tile)),
  };
}

/** Sprite ids a snapshot embeds or made tiles from, to look up which of them are blocked. */
export function listEmbeddedCustomSpriteIds(snapshot: RoomSnapshot): string[] {
  return [...new Set([
    ...(snapshot.customSprites ?? []).map((sprite) => sprite.id),
    ...(snapshot.customTiles ?? []).map((tile) => tile.sourceSpriteId).filter((id): id is string => Boolean(id)),
  ])];
}
