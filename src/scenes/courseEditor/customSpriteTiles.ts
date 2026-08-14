import type { CustomSpriteDefinition } from '../../customSprites/model';

export interface CourseCustomSpriteTileTarget {
  canSaveDraft: boolean;
  label: string;
  useCustomSpriteAsTile(sprite: CustomSpriteDefinition): boolean;
}

export interface CourseCustomSpriteTileSelectionResult {
  selected: boolean;
  statusText: string | null;
}

export function selectCustomSpriteTileForCourseRoom(
  sprite: CustomSpriteDefinition,
  target: CourseCustomSpriteTileTarget | null,
): CourseCustomSpriteTileSelectionResult {
  if (!target) {
    return {
      selected: false,
      statusText: 'Select an expanded-room cell before saving a tile.',
    };
  }
  if (!target.canSaveDraft) {
    return {
      selected: false,
      statusText: 'The selected room is read-only for this account.',
    };
  }
  if (!target.useCustomSpriteAsTile(sprite)) {
    return { selected: false, statusText: null };
  }

  return {
    selected: true,
    statusText: `Saved as tile in ${target.label}. Click in that room to paint it.`,
  };
}
