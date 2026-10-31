import { TRIANGLE_PIECE_OBJECT_ID, type GameObjectConfig } from '../../config';
import { parseCustomSpriteObjectId } from '../../customSprites/model';

export type EditorObjectScope = 'all' | 'stuff' | 'characters' | 'hazards' | 'deco';

export function objectMatchesEditorScope(
  objectConfig: Pick<GameObjectConfig, 'id' | 'category'>,
  scope: EditorObjectScope,
): boolean {
  if (objectConfig.id === TRIANGLE_PIECE_OBJECT_ID) return false;
  if (scope === 'all') return true;
  if (scope === 'stuff') {
    if (objectConfig.id === 'spawn_point') return false;
    if (parseCustomSpriteObjectId(objectConfig.id)) return true;
    return objectConfig.category === 'collectible'
      || objectConfig.category === 'interactive'
      || objectConfig.category === 'platform';
  }
  if (scope === 'characters') {
    return objectConfig.category === 'enemy' || objectConfig.category === 'npc';
  }
  if (scope === 'hazards') return objectConfig.category === 'hazard';
  return !parseCustomSpriteObjectId(objectConfig.id) && objectConfig.category === 'decoration';
}
