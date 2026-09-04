import { getApiBaseUrl } from '../api/baseUrl';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { WorldDetail } from './model';
import { getWorldOrigin, parseWorldSharePath } from './geometry';
import { setActiveWorldContext } from './clientContext';

let resolvedCoordinates: RoomCoordinates | null = null;

export async function resolveWorldLinkBeforeBoot(): Promise<void> {
  const worldNumber = parseWorldSharePath(window.location.pathname);
  if (worldNumber === null) return;
  resolvedCoordinates = getWorldOrigin(worldNumber);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/worlds/number/${worldNumber}`, {
      credentials: 'include',
    });
    if (!response.ok) return;
    const world = await response.json() as WorldDetail;
    resolvedCoordinates = { ...world.origin };
    if (world.number > 0) setActiveWorldContext({
      worldId: world.id,
      viewerRole: world.viewerRole,
      membershipStatus: world.viewerMembershipStatus,
    });
  } catch {
    // The stable numbered origin still makes the share link navigable while offline.
  }
}

export function getResolvedWorldLinkCoordinates(): RoomCoordinates | null {
  return resolvedCoordinates ? { ...resolvedCoordinates } : null;
}
