import type * as Party from 'partykit/server';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../config/room';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { ConnectionPresenceState, WorldGhostPresence } from './presenceProtocol';

export const PRESENCE_FAR_FLUSH_MS = 1_000;
export const PRESENCE_NEAR_LIMIT = 24;
type Connection = Party.Connection<ConnectionPresenceState>;

export function normalizeInterestRoom(value: unknown): RoomCoordinates | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as Partial<RoomCoordinates>;
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x: x!, y: y! } : null;
}

/** Select from the full live population, so a partial movement batch cannot rotate the cap. */
export function selectNearbyPeers(connection: Connection, peers: WorldGhostPresence[]): WorldGhostPresence[] {
  const state = connection.state;
  const focus = state?.interestRoom;
  if (!focus) return [];
  const local = state.presence;
  const sameRoom = local?.roomCoordinates.x === focus.x && local.roomCoordinates.y === focus.y;
  const originX = sameRoom ? local.x : (focus.x + 0.5) * ROOM_PX_WIDTH;
  const originY = sameRoom ? local.y : (focus.y + 0.5) * ROOM_PX_HEIGHT;
  const distance = (peer: WorldGhostPresence) =>
    (peer.x - originX) ** 2 + (peer.y - originY) ** 2;
  return peers.filter(peer => peer.connectionId !== connection.id && peer.userId !== state.userId &&
    Math.abs(peer.roomCoordinates.x - focus.x) <= 1 && Math.abs(peer.roomCoordinates.y - focus.y) <= 1)
    .sort((a, b) => distance(a) - distance(b) || a.connectionId.localeCompare(b.connectionId))
    .slice(0, PRESENCE_NEAR_LIMIT);
}

/** Latest-only far updates; snapshots, removals, chat, previews and populations use their own paths. */
export class PresenceInterestBroadcast {
  private readonly pending = new Map<string, WorldGhostPresence>();
  private readonly nearbyByConnection = new Map<string, Set<string>>();

  get hasPending(): boolean { return this.pending.size > 0; }
  forget(connectionId: string): void {
    this.pending.delete(connectionId);
    this.nearbyByConnection.delete(connectionId);
  }

  sendFast(connections: Connection[], changed: WorldGhostPresence[], all: WorldGhostPresence[]): void {
    if (connections.some(connection => connection.state?.presenceInterest)) {
      for (const peer of changed) this.pending.set(peer.connectionId, peer);
    }
    const legacy = JSON.stringify({ type: 'upserts', peers: changed });
    for (const connection of connections) {
      if (!connection.state?.presenceInterest) {
        connection.send(legacy);
        continue;
      }
      const nearPeers = selectNearbyPeers(connection, all);
      const nearby = new Set(nearPeers.map(peer => peer.connectionId));
      const previous = this.nearbyByConnection.get(connection.id);
      this.nearbyByConnection.set(connection.id, nearby);
      const matchId = connection.state.presence?.pvp?.matchId;
      const selected = changed.filter(peer => nearby.has(peer.connectionId) ||
        (matchId && peer.pvp?.matchId === matchId && peer.connectionId !== connection.id));
      const latest = new Map(selected.map(peer => [peer.connectionId, peer]));
      for (const peer of nearPeers) if (!previous?.has(peer.connectionId)) latest.set(peer.connectionId, peer);
      this.send(connection, [...latest.values()]);
    }
  }

  flushFar(connections: Connection[], all: WorldGhostPresence[]): void {
    // A new update may be in the 80ms fast queue when this timer fires. Read current state
    // rather than replaying an older queued position after a focus baseline.
    const changed = all.filter(peer => this.pending.has(peer.connectionId));
    this.pending.clear();
    for (const connection of connections) {
      if (!connection.state?.presenceInterest) continue;
      const nearby = new Set(selectNearbyPeers(connection, all).map(peer => peer.connectionId));
      const matchId = connection.state.presence?.pvp?.matchId;
      this.send(connection, changed.filter(peer => peer.connectionId !== connection.id &&
        peer.userId !== connection.state?.userId && !nearby.has(peer.connectionId) &&
        !(matchId && peer.pvp?.matchId === matchId)));
    }
  }

  sendFocusBaseline(connection: Connection, all: WorldGhostPresence[]): void {
    const peers = selectNearbyPeers(connection, all);
    this.nearbyByConnection.set(connection.id, new Set(peers.map(peer => peer.connectionId)));
    this.send(connection, peers);
  }

  private send(connection: Connection, peers: WorldGhostPresence[]): void {
    if (peers.length) connection.send(JSON.stringify({ type: 'upserts', peers }));
  }
}
