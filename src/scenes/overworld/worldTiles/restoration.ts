import { worldTileAddressKey, type WorldTileAddress } from './types';

export function orderWorldTilesForContextRestoration(input: {
  visible: readonly WorldTileAddress[];
  fallbackAncestors: readonly WorldTileAddress[];
  guards: readonly WorldTileAddress[];
}): WorldTileAddress[] {
  const result = new Map<string, WorldTileAddress>();
  for (const group of [input.visible, input.fallbackAncestors, input.guards]) {
    for (const address of group) {
      const key = worldTileAddressKey(address);
      if (!result.has(key)) result.set(key, address);
    }
  }
  return [...result.values()];
}

