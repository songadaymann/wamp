import type { SfxCue } from '../../../audio/sfx';

export function getCollectibleScoreValue(objectId: string): number {
  switch (objectId) {
    case 'gem':
    case 'blue_gem':
    case 'orange_gem':
    case 'red_gem':
    case 'black_pearl':
    case 'crown':
    case 'star':
      return 5;
    case 'coin_gold':
    case 'ring':
      return 3;
    case 'coin_silver':
      return 2;
    case 'kitkat':
      return 2;
    case 'coin_small_gold':
      return 2;
    case 'coin_small_silver':
      return 1;
    default:
      return 1;
  }
}

export function getCollectibleCue(objectId: string): SfxCue {
  switch (objectId) {
    case 'gem':
    case 'blue_gem':
    case 'orange_gem':
    case 'red_gem':
    case 'black_pearl':
    case 'crown':
    case 'ring':
    case 'star':
      return 'collect-gem';
    case 'key':
      return 'collect-key';
    case 'apple':
    case 'banana':
    case 'kitkat':
    case 'heart':
    case 'health_potion':
    case 'mana_potion':
    case 'mushroom':
    case 'egg':
      return 'collect-fruit';
    default:
      return 'collect';
  }
}
