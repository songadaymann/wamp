import {
  GAME_OBJECTS,
  getObjectById,
  type GameObjectConfig,
} from '../config';
import {
  getCustomSpriteObjectConfig,
  listCustomSpriteObjectConfigs,
} from './registry';

export function getEditorObjectConfigById(id: string | null | undefined): GameObjectConfig | undefined {
  if (!id) {
    return undefined;
  }

  return getObjectById(id) ?? getCustomSpriteObjectConfig(id) ?? undefined;
}

export function listEditorObjectConfigs(): GameObjectConfig[] {
  return [...GAME_OBJECTS, ...listCustomSpriteObjectConfigs()];
}
