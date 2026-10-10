import {
  getObjectById,
  getObjectDisplayOffset,
  getOppositePortalObjectId,
  isPortalObjectId,
  type PlacedObject,
} from '../config/objects';
import { getCourseObjectLink } from '../courses/objectLinks';
import type { CourseSnapshot } from '../courses/model';
import type { RoomSnapshot } from '../persistence/roomModel';
import { getPlacedObjectPathTargetIds } from '../placedObjects/objectPaths';

/** A room-local point, in the same space as trace breadcrumbs. */
export interface PortalHopPoint {
  roomX: number;
  roomY: number;
  x: number;
  y: number;
}

/** One way a player can be teleported: from a portal to the point it sends them to. */
export interface PortalHop {
  from: PortalHopPoint;
  to: PortalHopPoint;
}

interface PortalRef {
  room: RoomSnapshot;
  placed: PlacedObject & { instanceId: string };
}

/**
 * Every portal teleport the published rooms allow, following the play rules in
 * portalObjects.ts: a linked portal sends the player to its opposite-type target
 * (a course link takes precedence over the room's own link), and an unlinked portal
 * sends them back to a portal linked to it. The exit is the target's sprite position.
 */
export function listPortalHops(rooms: readonly RoomSnapshot[], course: CourseSnapshot | null = null): PortalHop[] {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const portals: PortalRef[] = rooms.flatMap((room) => room.placedObjects.flatMap((placed) =>
    isPortalObjectId(placed.id) && placed.instanceId ? [{ room, placed: placed as PortalRef['placed'] }] : []));

  const linkOf = (source: PortalRef): { roomId: string; instanceId: string } | null => {
    const courseLink = course ? getCourseObjectLink(course, source.room.id, source.placed.instanceId) : null;
    const instanceId = courseLink?.targetInstanceId ?? getPlacedObjectPathTargetIds(source.placed)[0] ?? null;
    const roomId = courseLink?.targetRoomId ?? (instanceId ? source.room.id : null);
    return instanceId && roomId ? { roomId, instanceId } : null;
  };
  const resolve = (source: PortalRef, link: { roomId: string; instanceId: string }): PortalRef | null => {
    const room = roomsById.get(link.roomId);
    const opposite = getOppositePortalObjectId(source.placed.id);
    const placed = room?.placedObjects.find((candidate) =>
      candidate.instanceId === link.instanceId && candidate.id === opposite);
    return room && placed ? { room, placed: placed as PortalRef['placed'] } : null;
  };

  const hops: PortalHop[] = [];
  for (const source of portals) {
    const link = linkOf(source);
    if (link) {
      const target = resolve(source, link);
      if (target) hops.push({ from: pointOf(source), to: pointOf(target) });
      continue;
    }
    for (const other of portals) {
      const otherLink = linkOf(other);
      if (otherLink && otherLink.roomId === source.room.id && otherLink.instanceId === source.placed.instanceId
        && other.placed.id === getOppositePortalObjectId(source.placed.id)) {
        hops.push({ from: pointOf(source), to: pointOf(other) });
      }
    }
  }
  return hops;
}

function pointOf(portal: PortalRef): PortalHopPoint {
  const config = getObjectById(portal.placed.id);
  const offset = config ? getObjectDisplayOffset(config) : { x: 0, y: 0 };
  return {
    roomX: portal.room.coordinates.x,
    roomY: portal.room.coordinates.y,
    x: portal.placed.x + offset.x,
    y: portal.placed.y + offset.y,
  };
}
