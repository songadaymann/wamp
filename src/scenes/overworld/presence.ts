import Phaser from 'phaser';
import {
  DEFAULT_PLAYER_ANIMATION_KEYS,
  DEFAULT_PLAYER_IDLE_FRAME,
  DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
  type DefaultPlayerAnimationState,
} from '../../player/defaultPlayer';
import { roomIdFromCoordinates, type RoomCoordinates } from '../../persistence/roomModel';
import { type WorldChunkBounds } from '../../persistence/worldModel';
import {
  resolveWorldPresenceConfig,
  resolveWorldPresenceIdentity,
  WorldPresenceClient,
  type WorldGhostPresence,
  type WorldPresenceIdentity,
  type WorldPresenceSnapshot,
} from '../../presence/worldPresence';
import type { OverworldMode } from '../sceneData';

export interface RenderedGhost {
  presence: WorldGhostPresence;
  halo: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
}

export interface BrowsePresenceDotPresence {
  connectionId: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
}

export interface PlayRoomPresenceMarkerDescriptor {
  roomId: string;
  coordinates: RoomCoordinates;
  population: number;
}

export interface OnlineRosterEntry {
  key: string;
  displayName: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  isSelf: boolean;
}

interface LocalPresenceInput {
  mode: OverworldMode;
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: DefaultPlayerAnimationState;
}

interface PresenceSummaryInput {
  mode: OverworldMode;
  currentRoomCoordinates: RoomCoordinates;
  selectedCoordinates: RoomCoordinates;
}

interface OverworldPresenceControllerOptions {
  scene: Phaser.Scene;
  isFullRoomLoaded: (roomId: string) => boolean;
  getMode: () => OverworldMode;
  getCurrentRoomCoordinates: () => RoomCoordinates;
  getSelectedCoordinates: () => RoomCoordinates;
  getZoom: () => number;
  onSnapshotUpdated?: () => void;
  onRoomActivityChanged?: () => void;
  onGhostDisplayObjectsChanged?: () => void;
}

export class OverworldPresenceController {
  private static readonly PRESENCE_STALE_MS = 15_000;
  private client: WorldPresenceClient | null = null;
  private identity: WorldPresenceIdentity | null = null;
  private snapshot: WorldPresenceSnapshot | null = null;
  private roomPopulationsById = new Map<string, number>();
  private roomEditorsById = new Map<string, number>();
  private renderedGhostsByConnectionId = new Map<string, RenderedGhost>();
  private subscribedChunkBounds: WorldChunkBounds | null = null;
  private subscribedBoundsRetainUntil = 0;
  private ghostRenderBudget = 0;
  private visibleGhostCount = 0;

  constructor(private readonly options: OverworldPresenceControllerOptions) {}

  initialize(): void {
    const config = resolveWorldPresenceConfig();
    if (!config) {
      this.snapshot = {
        enabled: false,
        status: 'disabled',
        subscribedShards: [],
        connectedShards: [],
        publishedShard: null,
        ghosts: [],
        roomPopulations: {},
        roomEditors: {},
      };
      this.roomPopulationsById = new Map();
      this.roomEditorsById = new Map();
      return;
    }

    this.identity = resolveWorldPresenceIdentity();
    this.client = new WorldPresenceClient({
      ...config,
      identity: this.identity,
      onSnapshot: (snapshot) => {
        const roomActivityChanged =
          !this.areCountMapsEqual(this.roomPopulationsById, snapshot.roomPopulations)
          || !this.areCountMapsEqual(this.roomEditorsById, snapshot.roomEditors);
        this.snapshot = snapshot;
        this.roomPopulationsById = new Map(Object.entries(snapshot.roomPopulations));
        this.roomEditorsById = new Map(Object.entries(snapshot.roomEditors));
        this.syncGhostRenderers();
        this.refreshGhostVisibility();
        if (roomActivityChanged) {
          this.options.onRoomActivityChanged?.();
        }
        this.options.onSnapshotUpdated?.();
      },
    });
  }

  reset(): void {
    this.destroy();
    this.identity = null;
    this.snapshot = null;
    this.roomPopulationsById = new Map();
    this.roomEditorsById = new Map();
    this.subscribedChunkBounds = null;
    this.subscribedBoundsRetainUntil = 0;
    this.ghostRenderBudget = 0;
    this.visibleGhostCount = 0;
  }

  destroy(): void {
    this.client?.destroy();
    this.client = null;
    this.destroyGhostRenderers();
    this.roomPopulationsById = new Map();
    this.roomEditorsById = new Map();
    this.snapshot = null;
    this.identity = null;
    this.subscribedChunkBounds = null;
    this.subscribedBoundsRetainUntil = 0;
    this.ghostRenderBudget = 0;
    this.visibleGhostCount = 0;
  }

  getClient(): WorldPresenceClient | null {
    return this.client;
  }

  getIdentity(): WorldPresenceIdentity | null {
    return this.identity;
  }

  getSnapshot(): WorldPresenceSnapshot | null {
    return this.snapshot;
  }

  getRoomPopulationsById(): Map<string, number> {
    return this.roomPopulationsById;
  }

  getRoomEditorsById(): Map<string, number> {
    return this.roomEditorsById;
  }

  getRenderedGhostsByConnectionId(): Map<string, RenderedGhost> {
    return this.renderedGhostsByConnectionId;
  }

  setSubscribedChunkBounds(bounds: WorldChunkBounds | null): void {
    if (!this.client || !bounds) {
      return;
    }

    if (this.subscribedChunkBounds && this.areChunkBoundsEqual(this.subscribedChunkBounds, bounds)) {
      return;
    }

    const now = Date.now();
    if (
      this.subscribedChunkBounds &&
      this.containsChunkBounds(this.subscribedChunkBounds, bounds) &&
      now < this.subscribedBoundsRetainUntil
    ) {
      return;
    }

    const chunks = [];
    for (let chunkY = bounds.minChunkY; chunkY <= bounds.maxChunkY; chunkY += 1) {
      for (let chunkX = bounds.minChunkX; chunkX <= bounds.maxChunkX; chunkX += 1) {
        chunks.push({ x: chunkX, y: chunkY });
      }
    }

    this.client.setSubscribedShards(chunks);
    this.subscribedChunkBounds = { ...bounds };
    this.subscribedBoundsRetainUntil = now + 1_200;
  }

  updateLocalPresence(input: LocalPresenceInput | null): void {
    if (!this.client || !input || input.mode !== 'play') {
      this.client?.updateLocalPresence(null);
      return;
    }

    this.client.updateLocalPresence({
      roomCoordinates: { ...input.roomCoordinates },
      x: input.x,
      y: input.y,
      velocityX: input.velocityX,
      velocityY: input.velocityY,
      facing: input.facing,
      animationState: input.animationState,
      mode: 'play',
      timestamp: Date.now(),
    });
  }

  updateGhosts(delta: number): void {
    const step = Math.min(1, delta / 90);
    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      renderedGhost.sprite.x = Phaser.Math.Linear(renderedGhost.sprite.x, renderedGhost.targetX, step);
      renderedGhost.sprite.y = Phaser.Math.Linear(renderedGhost.sprite.y, renderedGhost.targetY, step);
      renderedGhost.halo.x = renderedGhost.sprite.x;
      renderedGhost.halo.y = renderedGhost.sprite.y - 2;
      renderedGhost.label.setPosition(renderedGhost.sprite.x, renderedGhost.sprite.y - 28);
    }
  }

  refreshGhostVisibility(): void {
    this.syncGhostRenderers();
    const showGhosts = this.options.getMode() === 'play';
    let visibleGhostCount = 0;
    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      const visible =
        showGhosts &&
        this.options.isFullRoomLoaded(renderedGhost.presence.roomId) &&
        this.isPresenceFresh(renderedGhost.presence.timestamp);
      renderedGhost.halo.setVisible(visible);
      renderedGhost.sprite.setVisible(visible);
      renderedGhost.label.setVisible(visible);
      if (visible) {
        visibleGhostCount += 1;
      }
    }
    this.visibleGhostCount = visibleGhostCount;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const objects: Phaser.GameObjects.GameObject[] = [];
    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      objects.push(renderedGhost.halo, renderedGhost.sprite, renderedGhost.label);
    }
    return objects;
  }

  getRoomPopulation(coordinates: RoomCoordinates): number {
    return this.roomPopulationsById.get(roomIdFromCoordinates(coordinates)) ?? 0;
  }

  getRoomEditorCount(coordinates: RoomCoordinates): number {
    return this.roomEditorsById.get(roomIdFromCoordinates(coordinates)) ?? 0;
  }

  getTotalPlayerCount(): number | null {
    if (!this.snapshot?.enabled) {
      return null;
    }

    let total = 0;
    for (const count of this.roomPopulationsById.values()) {
      total += count;
    }

    return total;
  }

  getOnlineRoster(): OnlineRosterEntry[] {
    if (!this.snapshot?.enabled) {
      return [];
    }

    const entries: OnlineRosterEntry[] = (this.snapshot.ghosts ?? [])
      .filter((ghost) => ghost.mode === 'play' && this.isPresenceFresh(ghost.timestamp))
      .sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return right.timestamp - left.timestamp;
        }

        return left.displayName.localeCompare(right.displayName);
      })
      .map((ghost) => ({
        key: ghost.connectionId,
        displayName: ghost.displayName,
        roomId: ghost.roomId,
        roomCoordinates: { ...ghost.roomCoordinates },
        isSelf: false,
      }));

    const totalPlayerCount = this.getTotalPlayerCount();
    if (
      totalPlayerCount !== null &&
      totalPlayerCount > entries.length &&
      this.options.getMode() === 'play' &&
      this.identity
    ) {
      const roomCoordinates = this.options.getCurrentRoomCoordinates();
      entries.unshift({
        key: `self:${this.identity.userId}`,
        displayName: this.identity.displayName,
        roomId: roomIdFromCoordinates(roomCoordinates),
        roomCoordinates: { ...roomCoordinates },
        isSelf: true,
      });
    }

    return entries;
  }

  getPresenceSummaryText(input: PresenceSummaryInput): string | null {
    if (!this.snapshot?.enabled) {
      return null;
    }

    const focusCoordinates =
      input.mode === 'play' ? input.currentRoomCoordinates : input.selectedCoordinates;
    const population = this.getRoomPopulation(focusCoordinates);
    const editorCount = this.getRoomEditorCount(focusCoordinates);
    const visibleGhosts = Array.from(this.renderedGhostsByConnectionId.values()).filter(
      (renderedGhost) => renderedGhost.sprite.visible
    ).length;
    const parts: string[] = [];

    if (population > 0) {
      parts.push(`${population} active ${population === 1 ? 'player' : 'players'} here`);
    }

    if (visibleGhosts > 0) {
      parts.push(`${visibleGhosts} ${visibleGhosts === 1 ? 'ghost' : 'ghosts'} nearby`);
    }

    if (editorCount > 0) {
      parts.push(`${editorCount} ${editorCount === 1 ? 'builder' : 'builders'} editing here`);
    }

    if (this.snapshot.status === 'connecting') {
      parts.push('presence syncing');
    }

    if (parts.length === 0) {
      return this.snapshot.status === 'connected' ? 'presence live' : null;
    }

    return parts.join(' · ');
  }

  getDebugSnapshot(): {
    identity: WorldPresenceIdentity | null;
    snapshot: WorldPresenceSnapshot | null;
    subscribedChunkBounds: WorldChunkBounds | null;
    ghostRenderBudget: number;
    renderedGhostCount: number;
    visibleGhostCount: number;
    roomPopulations: Record<string, number>;
    roomEditors: Record<string, number>;
    ghosts: Array<{
      connectionId: string;
      userId: string;
      displayName: string;
      roomId: string;
      x: number;
      y: number;
      animationState: WorldGhostPresence['animationState'];
      visible: boolean;
    }>;
  } {
    return {
      identity: this.identity,
      snapshot: this.snapshot,
      subscribedChunkBounds: this.subscribedChunkBounds ? { ...this.subscribedChunkBounds } : null,
      ghostRenderBudget: this.ghostRenderBudget,
      renderedGhostCount: this.renderedGhostsByConnectionId.size,
      visibleGhostCount: this.visibleGhostCount,
      roomPopulations: Object.fromEntries(
        Array.from(this.roomPopulationsById.entries()).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      ),
      roomEditors: Object.fromEntries(
        Array.from(this.roomEditorsById.entries()).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      ),
      ghosts: Array.from(this.renderedGhostsByConnectionId.values()).map((renderedGhost) => ({
        connectionId: renderedGhost.presence.connectionId,
        userId: renderedGhost.presence.userId,
        displayName: renderedGhost.presence.displayName,
        roomId: renderedGhost.presence.roomId,
        x: Math.round(renderedGhost.targetX),
        y: Math.round(renderedGhost.targetY),
        animationState: renderedGhost.presence.animationState,
        visible: renderedGhost.sprite.visible,
      })),
    };
  }

  getSampledBrowsePresenceDots(
    visibleRooms: RoomCoordinates[],
    maxDots = 96,
    perRoomLimit = 4,
  ): BrowsePresenceDotPresence[] {
    if (this.options.getMode() !== 'browse' || !this.snapshot?.enabled || visibleRooms.length === 0) {
      return [];
    }

    const visibleRoomIds = new Set(visibleRooms.map((coordinates) => roomIdFromCoordinates(coordinates)));
    const visibleGhosts = (this.snapshot.ghosts ?? []).filter((ghost) =>
      ghost.mode === 'play'
      && visibleRoomIds.has(ghost.roomId)
      && this.isPresenceFresh(ghost.timestamp)
      && (!this.identity || ghost.userId !== this.identity.userId)
    );
    if (visibleGhosts.length === 0) {
      return [];
    }

    const groupedByRoomId = new Map<string, WorldGhostPresence[]>();
    for (const ghost of visibleGhosts) {
      const group = groupedByRoomId.get(ghost.roomId);
      if (group) {
        group.push(ghost);
      } else {
        groupedByRoomId.set(ghost.roomId, [ghost]);
      }
    }

    const focusCoordinates = this.options.getSelectedCoordinates();
    const orderedRooms = [...groupedByRoomId.entries()]
      .map(([roomId, ghosts]) => {
        ghosts.sort((left, right) => {
          if (left.timestamp !== right.timestamp) {
            return right.timestamp - left.timestamp;
          }

          return left.connectionId.localeCompare(right.connectionId);
        });
        return {
          roomId,
          roomCoordinates: ghosts[0]?.roomCoordinates ?? focusCoordinates,
          ghosts,
          newestTimestamp: ghosts[0]?.timestamp ?? 0,
        };
      })
      .sort((left, right) => {
        const leftDistance =
          Math.abs(left.roomCoordinates.x - focusCoordinates.x)
          + Math.abs(left.roomCoordinates.y - focusCoordinates.y);
        const rightDistance =
          Math.abs(right.roomCoordinates.x - focusCoordinates.x)
          + Math.abs(right.roomCoordinates.y - focusCoordinates.y);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        if (left.newestTimestamp !== right.newestTimestamp) {
          return right.newestTimestamp - left.newestTimestamp;
        }

        return left.roomId.localeCompare(right.roomId);
      });

    const sampled: BrowsePresenceDotPresence[] = [];
    for (const room of orderedRooms) {
      if (sampled.length >= maxDots) {
        break;
      }

      const ghost = room.ghosts[0];
      if (!ghost) {
        continue;
      }

      sampled.push({
        connectionId: ghost.connectionId,
        roomId: ghost.roomId,
        roomCoordinates: { ...ghost.roomCoordinates },
        x: ghost.x,
        y: ghost.y,
      });
    }

    for (let slot = 1; slot < perRoomLimit && sampled.length < maxDots; slot += 1) {
      for (const room of orderedRooms) {
        if (sampled.length >= maxDots) {
          break;
        }

        const ghost = room.ghosts[slot];
        if (!ghost) {
          continue;
        }

        sampled.push({
          connectionId: ghost.connectionId,
          roomId: ghost.roomId,
          roomCoordinates: { ...ghost.roomCoordinates },
          x: ghost.x,
          y: ghost.y,
        });
      }
    }

    return sampled;
  }

  getPlayRoomPresenceMarkers(
    visibleRooms: RoomCoordinates[],
    currentRoomCoordinates: RoomCoordinates,
  ): PlayRoomPresenceMarkerDescriptor[] {
    if (this.options.getMode() !== 'play' || !this.snapshot?.enabled || visibleRooms.length === 0) {
      return [];
    }

    return visibleRooms
      .filter((coordinates) =>
        coordinates.x !== currentRoomCoordinates.x || coordinates.y !== currentRoomCoordinates.y
      )
      .map((coordinates) => ({
        roomId: roomIdFromCoordinates(coordinates),
        coordinates,
        population: this.getRoomPopulation(coordinates),
      }))
      .filter((entry) => entry.population > 0)
      .sort((left, right) => {
        const leftDistance =
          Math.abs(left.coordinates.x - currentRoomCoordinates.x)
          + Math.abs(left.coordinates.y - currentRoomCoordinates.y);
        const rightDistance =
          Math.abs(right.coordinates.x - currentRoomCoordinates.x)
          + Math.abs(right.coordinates.y - currentRoomCoordinates.y);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        if (left.population !== right.population) {
          return right.population - left.population;
        }

        return left.roomId.localeCompare(right.roomId);
      });
  }

  private areCountMapsEqual(
    current: Map<string, number>,
    next: Record<string, number>
  ): boolean {
    if (current.size !== Object.keys(next).length) {
      return false;
    }

    for (const [roomId, count] of current.entries()) {
      if ((next[roomId] ?? 0) !== count) {
        return false;
      }
    }

    return true;
  }

  private syncGhostRenderers(): void {
    const ghostsToRender = this.getPrioritizedGhostsToRender();
    this.ghostRenderBudget = this.getGhostRenderBudget();
    let structureChanged = false;
    const nextGhostIds = new Set<string>();
    for (const ghost of ghostsToRender) {
      nextGhostIds.add(ghost.connectionId);
      const existing = this.renderedGhostsByConnectionId.get(ghost.connectionId);
      if (!existing) {
        this.renderedGhostsByConnectionId.set(ghost.connectionId, this.createRenderedGhost(ghost));
        structureChanged = true;
        continue;
      }

      existing.presence = ghost;
      existing.targetX = ghost.x;
      existing.targetY = ghost.y;
      existing.sprite.setFlipX(ghost.facing < 0);
      existing.label.setText(ghost.displayName);
      const animationKey = DEFAULT_PLAYER_ANIMATION_KEYS[ghost.animationState];
      if (existing.sprite.anims.currentAnim?.key !== animationKey) {
        existing.sprite.play(animationKey, true);
      }
    }

    for (const [connectionId, renderedGhost] of this.renderedGhostsByConnectionId.entries()) {
      if (nextGhostIds.has(connectionId)) {
        continue;
      }

      this.destroyRenderedGhost(renderedGhost);
      this.renderedGhostsByConnectionId.delete(connectionId);
      structureChanged = true;
    }

    if (structureChanged) {
      this.options.onGhostDisplayObjectsChanged?.();
    }
  }

  private getPrioritizedGhostsToRender(): WorldGhostPresence[] {
    const budget = this.getGhostRenderBudget();
    if (budget <= 0) {
      return [];
    }

    const focusCoordinates =
      this.options.getMode() === 'play'
        ? this.options.getCurrentRoomCoordinates()
        : this.options.getSelectedCoordinates();

    return [...(this.snapshot?.ghosts ?? [])]
      .sort((left, right) => {
        const leftLoaded = this.options.isFullRoomLoaded(left.roomId) ? 0 : 1;
        const rightLoaded = this.options.isFullRoomLoaded(right.roomId) ? 0 : 1;
        if (leftLoaded !== rightLoaded) {
          return leftLoaded - rightLoaded;
        }

        const leftDistance =
          Math.abs(left.roomCoordinates.x - focusCoordinates.x) +
          Math.abs(left.roomCoordinates.y - focusCoordinates.y);
        const rightDistance =
          Math.abs(right.roomCoordinates.x - focusCoordinates.x) +
          Math.abs(right.roomCoordinates.y - focusCoordinates.y);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        if (left.timestamp !== right.timestamp) {
          return right.timestamp - left.timestamp;
        }

        return left.displayName.localeCompare(right.displayName);
      })
      .slice(0, budget);
  }

  private getGhostRenderBudget(): number {
    if (this.options.getMode() !== 'play') {
      return 0;
    }

    const zoom = Math.max(this.options.getZoom(), 0.08);
    if (zoom <= 0.16) {
      return 12;
    }

    if (zoom <= 0.24) {
      return 18;
    }

    return 24;
  }

  private areChunkBoundsEqual(left: WorldChunkBounds, right: WorldChunkBounds): boolean {
    return (
      left.minChunkX === right.minChunkX &&
      left.maxChunkX === right.maxChunkX &&
      left.minChunkY === right.minChunkY &&
      left.maxChunkY === right.maxChunkY
    );
  }

  private containsChunkBounds(container: WorldChunkBounds, inner: WorldChunkBounds): boolean {
    return (
      container.minChunkX <= inner.minChunkX &&
      container.maxChunkX >= inner.maxChunkX &&
      container.minChunkY <= inner.minChunkY &&
      container.maxChunkY >= inner.maxChunkY
    );
  }

  private createRenderedGhost(ghost: WorldGhostPresence): RenderedGhost {
    const halo = this.options.scene.add.ellipse(ghost.x, ghost.y - 2, 18, 8, 0xffffff, 0.28);
    halo.setDepth(22);

    const sprite = this.options.scene.add.sprite(
      ghost.x,
      ghost.y,
      DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
      DEFAULT_PLAYER_IDLE_FRAME
    );
    sprite.setOrigin(0.5, 1);
    sprite.setAlpha(0.74);
    sprite.setDepth(24);
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    sprite.setFlipX(ghost.facing < 0);
    sprite.play(DEFAULT_PLAYER_ANIMATION_KEYS[ghost.animationState]);

    const label = this.options.scene.add.text(ghost.x, ghost.y - 28, ghost.displayName, {
      fontFamily: 'Courier New',
      fontSize: '11px',
      color: '#f3eee2',
      backgroundColor: '#050505',
      stroke: '#050505',
      strokeThickness: 3,
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5, 1);
    label.setAlpha(0.94);
    label.setDepth(25);

    return {
      presence: ghost,
      halo,
      sprite,
      label,
      targetX: ghost.x,
      targetY: ghost.y,
    };
  }

  private destroyGhostRenderers(): void {
    if (this.renderedGhostsByConnectionId.size === 0) {
      return;
    }

    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      this.destroyRenderedGhost(renderedGhost);
    }
    this.renderedGhostsByConnectionId.clear();
    this.options.onGhostDisplayObjectsChanged?.();
  }

  private destroyRenderedGhost(renderedGhost: RenderedGhost): void {
    renderedGhost.halo.destroy();
    renderedGhost.sprite.destroy();
    renderedGhost.label.destroy();
  }

  private isPresenceFresh(timestamp: number): boolean {
    return Date.now() - timestamp <= OverworldPresenceController.PRESENCE_STALE_MS;
  }
}
