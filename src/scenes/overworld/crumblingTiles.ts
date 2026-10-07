export const CRUMBLE_SHAKE_MS = 400;
export const CRUMBLE_RETURN_MS = 2_000;

export interface CrumblingTileAddress { roomId: string; tileX: number; tileY: number }
interface CrumblingTileState extends CrumblingTileAddress {
  startedAt: number;
  goneAt: number | null;
  warning: { shake: (offset: number) => void; destroy: () => void } | null;
}

/** Owns temporary terrain changes, never the saved room snapshot. */
export class OverworldCrumblingTilesController {
  private readonly statesByRoom = new Map<string, Map<string, CrumblingTileState>>();

  constructor(private readonly host: {
    showWarning: (tile: CrumblingTileAddress) => CrumblingTileState['warning'];
    removeTile: (tile: CrumblingTileAddress) => void;
    restoreTile: (tile: CrumblingTileAddress) => void;
    isOccupied: (tile: CrumblingTileAddress) => boolean;
    refreshRoom: (roomId: string) => void;
  }) {}

  update(now: number, contacts: Iterable<CrumblingTileAddress>): void {
    const changedRooms = new Set<string>();
    for (const tile of contacts) {
      let states = this.statesByRoom.get(tile.roomId);
      if (!states) { states = new Map(); this.statesByRoom.set(tile.roomId, states); }
      const key = `${tile.tileX},${tile.tileY}`;
      if (states.has(key)) continue;
      states.set(key, { ...tile, startedAt: now, goneAt: null, warning: this.host.showWarning(tile) });
      changedRooms.add(tile.roomId);
    }

    for (const [roomId, states] of this.statesByRoom) {
      for (const [key, state] of states) {
        if (state.goneAt === null) {
          if (now < state.startedAt + CRUMBLE_SHAKE_MS) {
            state.warning?.shake(Math.round(Math.sin((now - state.startedAt) / 22)));
            continue;
          }
          this.host.removeTile(state);
          state.goneAt = now;
          state.warning?.destroy();
          state.warning = null;
        } else if (now >= state.goneAt + CRUMBLE_RETURN_MS && !this.host.isOccupied(state)) {
          this.host.restoreTile(state);
          states.delete(key);
          changedRooms.add(roomId);
        }
      }
      if (states.size === 0) this.statesByRoom.delete(roomId);
    }
    for (const roomId of changedRooms) this.host.refreshRoom(roomId);
  }

  getHiddenTiles(roomId: string): Iterable<CrumblingTileAddress> {
    return this.statesByRoom.get(roomId)?.values() ?? [];
  }

  isGone(roomId: string, tileX: number, tileY: number): boolean {
    const state = this.statesByRoom.get(roomId)?.get(`${tileX},${tileY}`);
    return Boolean(state && state.goneAt !== null);
  }

  describe(now: number): Array<CrumblingTileAddress & { phase: 'shaking' | 'gone'; remainingMs: number }> {
    return Array.from(this.statesByRoom.values()).flatMap(states => Array.from(states.values(), state => ({
      roomId: state.roomId, tileX: state.tileX, tileY: state.tileY,
      phase: state.goneAt === null ? 'shaking' : 'gone',
      remainingMs: Math.max(0, Math.round((state.goneAt === null ? state.startedAt + CRUMBLE_SHAKE_MS
        : state.goneAt + CRUMBLE_RETURN_MS) - now)),
    })));
  }

  resetRoom(roomId: string): void {
    const states = this.statesByRoom.get(roomId);
    if (!states) return;
    for (const state of states.values()) {
      state.warning?.destroy();
      if (state.goneAt !== null) this.host.restoreTile(state);
    }
    this.statesByRoom.delete(roomId);
    this.host.refreshRoom(roomId);
  }

  destroyRoom(roomId: string): void {
    for (const state of this.statesByRoom.get(roomId)?.values() ?? []) state.warning?.destroy();
    this.statesByRoom.delete(roomId);
  }
}
