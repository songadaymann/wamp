import type { PlacedObject } from '../config';
import type { CustomSpriteKind } from '../customSprites/model';

export const SIGN_TEXT_MAX_LENGTH = 140;

export const SIGN_OBJECT_IDS = ['sign', 'sign_arrow'] as const;

export type SignObjectId = (typeof SIGN_OBJECT_IDS)[number];

export function isSignObjectId(id: string): id is SignObjectId {
  return (SIGN_OBJECT_IDS as readonly string[]).includes(id);
}

export function canPlacedObjectHaveSignText<T extends { id: string; customSpriteKind?: CustomSpriteKind | null }>(
  placed: T | null | undefined,
): placed is T {
  return isSignObjectId(placed?.id ?? '') || placed?.customSpriteKind === 'sign';
}

export function normalizeSignText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, SIGN_TEXT_MAX_LENGTH);
}

export function getPlacedObjectSignText(
  placed: Pick<PlacedObject, 'id' | 'signText' | 'customSpriteKind'> | null | undefined,
): string | null {
  if (!canPlacedObjectHaveSignText(placed)) {
    return null;
  }

  return normalizeSignText(placed.signText);
}
