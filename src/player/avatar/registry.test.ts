import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  GAMEJEW_RED_PLAYER_AVATAR_ID,
  getRegisteredPlayerAvatarPack,
} from './registry';

interface AtlasJson {
  frames: Record<string, unknown>;
  meta: { image: string; size: { width?: number; height?: number; w?: number; h?: number } };
}

describe('GameJew Red avatar pack', () => {
  it('registers the corrected default-compatible atlas assets', async () => {
    const pack = getRegisteredPlayerAvatarPack(GAMEJEW_RED_PLAYER_AVATAR_ID);

    expect(pack?.atlasAssets).toEqual([
      {
        key: 'player-gamejew-red-base-atlas',
        texturePath: 'assets/player/gamejew-red/PlayerSheet.png',
        atlasPath: 'assets/player/gamejew-red/PlayerSheet.json',
      },
      {
        key: 'player-gamejew-red-combat-atlas',
        texturePath: 'assets/player/gamejew-red/PlayerCombatActionsSheet.png',
        atlasPath: 'assets/player/gamejew-red/PlayerCombatActionsSheet.json',
      },
    ]);

    const [prizeBase, defaultBase, prizeCombat, defaultCombat] = await Promise.all([
      loadAtlas('public/assets/player/gamejew-red/PlayerSheet.json'),
      loadAtlas('public/assets/player/default/PlayerSheet.json'),
      loadAtlas('public/assets/player/gamejew-red/PlayerCombatActionsSheet.json'),
      loadAtlas('public/assets/player/default/PlayerCombatActionsSheet.json'),
    ]);

    expect(Object.keys(prizeBase.frames)).toEqual(Object.keys(defaultBase.frames));
    expect(Object.keys(prizeCombat.frames)).toEqual(Object.keys(defaultCombat.frames));
    expect(prizeCombat.meta).toEqual(defaultCombat.meta);
  });
});

async function loadAtlas(path: string): Promise<AtlasJson> {
  return JSON.parse(await readFile(path, 'utf8')) as AtlasJson;
}
