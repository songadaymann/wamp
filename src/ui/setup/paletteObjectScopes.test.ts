import { describe, expect, it } from 'vitest';
import { objectMatchesEditorScope, type EditorObjectScope } from './paletteController';

const objects = {
  spawn: { id: 'spawn_point', category: 'interactive' },
  collectible: { id: 'coin', category: 'collectible' },
  utility: { id: 'spring', category: 'interactive' },
  platform: { id: 'moving_platform', category: 'platform' },
  custom: { id: 'custom_sprite:mine-1', category: 'decoration' },
  enemy: { id: 'slime', category: 'enemy' },
  npc: { id: 'npc', category: 'npc' },
  hazard: { id: 'spikes', category: 'hazard' },
  deco: { id: 'tree', category: 'decoration' },
} as const;

function included(scope: EditorObjectScope): string[] {
  return Object.entries(objects)
    .filter(([, object]) => objectMatchesEditorScope(object, scope))
    .map(([name]) => name);
}

describe('editor object workspace membership', () => {
  it('keeps Stuff to community/mine, collect, and utility objects without spawn', () => {
    expect(included('stuff')).toEqual(['collectible', 'utility', 'platform', 'custom']);
  });

  it('separates characters, hazards, and decoration', () => {
    expect(included('characters')).toEqual(['enemy', 'npc']);
    expect(included('hazards')).toEqual(['hazard']);
    expect(included('deco')).toEqual(['deco']);
  });
});
