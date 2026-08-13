import type * as Party from 'partykit/server';
import type { RoomCoordinates } from '../persistence/roomModel';
import {
  isVisiblePresence,
  type ConnectionPresenceState,
  type PresencePayload,
  type WorldGhostPresence,
} from './presenceProtocol';

type PresenceConnection = Party.Connection<ConnectionPresenceState>;

export function roomIdFromPresenceCoordinates(roomCoordinates: RoomCoordinates): string {
  return `${roomCoordinates.x},${roomCoordinates.y}`;
}

export function roomIdFromUnknownCoordinates(roomCoordinates: unknown): string | null {
  if (
    !roomCoordinates ||
    typeof roomCoordinates !== 'object' ||
    !Number.isInteger((roomCoordinates as Partial<RoomCoordinates>).x) ||
    !Number.isInteger((roomCoordinates as Partial<RoomCoordinates>).y)
  ) {
    return null;
  }
  return roomIdFromPresenceCoordinates(roomCoordinates as RoomCoordinates);
}

export function toWorldGhostPresence(
  connection: PresenceConnection,
  shardId: string,
): WorldGhostPresence | null {
  const state = connection.state;
  if (state?.channel !== 'presence' || !isVisiblePresence(state.presence)) return null;

  return {
    ...state.presence,
    connectionId: connection.id,
    userId: state.userId,
    displayName: state.displayName,
    avatarId: state.avatarId,
    shardId,
    roomId: roomIdFromPresenceCoordinates(state.presence.roomCoordinates),
  };
}

export function listWorldGhostPeers(
  connections: Iterable<PresenceConnection>,
  viewer: PresenceConnection | null,
  shardId: string,
): WorldGhostPresence[] {
  const peers: WorldGhostPresence[] = [];
  const excludeConnectionId = viewer?.id ?? null;
  const excludeUserId = viewer?.state?.userId ?? null;

  for (const connection of connections) {
    if (excludeConnectionId && connection.id === excludeConnectionId) continue;
    if (excludeUserId && connection.state?.userId === excludeUserId) continue;
    const peer = toWorldGhostPresence(connection, shardId);
    if (peer) peers.push(peer);
  }

  return peers.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function computePresenceRoomCounts(
  connections: Iterable<PresenceConnection>,
  mode: 'play' | 'edit',
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    const presence = connection.state?.presence;
    if (connection.state?.channel !== 'presence' || !presence || presence.mode !== mode) continue;
    const roomId = roomIdFromPresenceCoordinates(presence.roomCoordinates);
    counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function shouldBroadcastPresencePopulations(
  previousPresence: PresencePayload | null,
  nextPresence: PresencePayload | null,
): boolean {
  const previousCountsMode = getPopulationMode(previousPresence);
  const nextCountsMode = getPopulationMode(nextPresence);
  const previousRoomId = previousPresence
    ? roomIdFromPresenceCoordinates(previousPresence.roomCoordinates)
    : null;
  const nextRoomId = nextPresence
    ? roomIdFromPresenceCoordinates(nextPresence.roomCoordinates)
    : null;
  return previousCountsMode !== nextCountsMode || previousRoomId !== nextRoomId;
}

function getPopulationMode(presence: PresencePayload | null): 'play' | 'edit' | null {
  if (!presence || (presence.mode !== 'play' && presence.mode !== 'edit')) return null;
  return presence.mode;
}
