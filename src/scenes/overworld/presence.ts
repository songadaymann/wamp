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
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
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
        Date.now() - renderedGhost.presence.timestamp <= 15_000;
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
      objects.push(renderedGhost.sprite, renderedGhost.label);
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
    const sprite = this.options.scene.add.sprite(
      ghost.x,
      ghost.y,
      DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
      DEFAULT_PLAYER_IDLE_FRAME
    );
    sprite.setOrigin(0.5, 1);
    sprite.setAlpha(0.5);
    sprite.setDepth(24);
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    sprite.setFlipX(ghost.facing < 0);
    sprite.play(DEFAULT_PLAYER_ANIMATION_KEYS[ghost.animationState]);

    const label = this.options.scene.add.text(ghost.x, ghost.y - 28, ghost.displayName, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: '#d9d1c3',
      backgroundColor: '#050505',
      padding: { x: 3, y: 1 },
    });
    label.setOrigin(0.5, 1);
    label.setAlpha(0.82);
    label.setDepth(23);

    return {
      presence: ghost,
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
    renderedGhost.sprite.destroy();
    renderedGhost.label.destroy();
  }
}
