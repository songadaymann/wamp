import Phaser from 'phaser';
import {
  type DefaultPlayerAnimationState,
} from '../../player/defaultPlayer';
import {
  ensureSceneAvatarPackLoaded,
  isSceneAvatarPackLoaded,
  isDynamicPlayerAvatarId,
} from '../../player/avatar/dynamic';
import { getRegisteredPlayerAvatarPack } from '../../player/avatar/registry';
import { resolvePlayerAvatarPack } from '../../player/avatar/runtime';
import { roomIdFromCoordinates, type RoomCoordinates } from '../../persistence/roomModel';
import type {
  PvpInviteOffer,
  PvpInviteSendMessage,
  PvpMatchSnapshot,
  PvpPresenceServerMessage,
} from '../../pvp/model';
import {
  areWorldChunkBoundsEqual,
  containsWorldChunkBounds,
  type WorldChunkBounds,
} from '../../persistence/worldModel';
import {
  resolveWorldPresenceConfig,
  resolveWorldPresenceIdentity,
  WorldPresenceClient,
  type WorldGhostPresence,
  type WorldPresenceIdentity,
  type WorldPresencePvpAction,
  type WorldPresenceRoomPreview,
  type WorldPresenceSnapshot,
} from '../../presence/worldPresence';
import type { OverworldMode } from '../sceneData';

const BROWSE_PRESENCE_DOT_MAX_TOTAL = 192;
const BROWSE_PRESENCE_DOT_MAX_PER_ROOM = 12;

export interface RenderedGhost {
  presence: WorldGhostPresence;
  halo: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  actionIndicator: Phaser.GameObjects.Rectangle;
  actionAccent: Phaser.GameObjects.Rectangle;
  actionProjectile: Phaser.GameObjects.Rectangle;
  targetX: number;
  targetY: number;
  cachedLabelText: string;
  pvpPresentationActive: boolean | null;
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
  userId: string | null;
  displayName: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  mode: WorldGhostPresence['mode'];
  isSelf: boolean;
}

export interface LocalPresenceInput {
  readonly mode: OverworldMode;
  readonly roomCoordinates: Readonly<RoomCoordinates>;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly facing: number;
  readonly animationState: DefaultPlayerAnimationState;
  readonly pvp?: {
    readonly matchId: string;
    readonly action: WorldPresencePvpAction | null;
    readonly actionUntil: number;
  } | null;
}

interface LocalPresenceDeadlineSnapshot {
  mode: OverworldMode;
  roomX: number;
  roomY: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: DefaultPlayerAnimationState;
  pvpMatchId: string;
  pvpAction: WorldPresencePvpAction | null;
  pvpActionUntilBucket: number;
}

interface PresenceSummaryInput {
  mode: OverworldMode;
  currentRoomCoordinates: RoomCoordinates;
  selectedCoordinates: RoomCoordinates;
}

interface OverworldPresenceControllerOptions {
  scene: Phaser.Scene;
  isFullRoomLoaded: (roomId: string) => boolean;
  isConstructionRoomLoaded: (roomId: string) => boolean;
  getMode: () => OverworldMode;
  getCurrentRoomCoordinates: () => RoomCoordinates;
  getSelectedCoordinates: () => RoomCoordinates;
  getZoom: () => number;
  measurePerformance?: <T>(label: string, callback: () => T) => T;
  onSnapshotUpdated?: () => void;
  onRoomActivityChanged?: () => void;
  onPvpInvite?: (invite: PvpInviteOffer) => void;
  onPvpInviteAccepted?: (message: Extract<PvpPresenceServerMessage, { type: 'pvp:invite:accepted' }>) => void;
  onPvpInviteDeclined?: (message: Extract<PvpPresenceServerMessage, { type: 'pvp:invite:declined' }>) => void;
}

export class OverworldPresenceController {
  private static readonly PRESENCE_STALE_MS = 15_000;
  private client: WorldPresenceClient | null = null;
  private identity: WorldPresenceIdentity | null = null;
  private snapshot: WorldPresenceSnapshot | null = null;
  private roomPopulationsById = new Map<string, number>();
  private roomEditorsById = new Map<string, number>();
  private roomPreviewsById = new Map<string, WorldPresenceRoomPreview>();
  private renderedGhostsByConnectionId = new Map<string, RenderedGhost>();
  private subscribedChunkBounds: WorldChunkBounds | null = null;
  private subscribedBoundsRetainUntil = 0;
  private ghostRenderBudget = 0;
  private visibleGhostCount = 0;
  private localRosterPresence: Pick<LocalPresenceInput, 'mode' | 'roomCoordinates'> | null = null;
  private localPresenceDeadlineSnapshot: LocalPresenceDeadlineSnapshot | null = null;
  private lastLocalPresenceForwardedAt = 0;
  private hasForwardedLocalPresence = false;
  private pendingGhostAvatarLoads = new Set<string>();
  private pvpMatchSnapshot: PvpMatchSnapshot | null = null;
  private pvpLocalUserId: string | null = null;
  private pvpInstanceOpponentUserId: string | null = null;
  private readonly predictedGhostTargetScratch = { x: 0, y: 0 };

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
        roomPreviews: {},
      };
      this.roomPopulationsById = new Map();
      this.roomEditorsById = new Map();
      this.roomPreviewsById = new Map();
      return;
    }

    this.identity = resolveWorldPresenceIdentity();
    this.client = new WorldPresenceClient({
      ...config,
      identity: this.identity,
      onPvpInvite: (invite) => this.options.onPvpInvite?.(invite),
      onPvpInviteAccepted: (message) => this.options.onPvpInviteAccepted?.(message),
      onPvpInviteDeclined: (message) => this.options.onPvpInviteDeclined?.(message),
      onSnapshot: (snapshot) => {
        const reconcileSnapshot = () => {
          const roomActivityChanged =
            !this.areCountMapsEqual(this.roomPopulationsById, snapshot.roomPopulations)
            || !this.areCountMapsEqual(this.roomEditorsById, snapshot.roomEditors);
          this.roomPreviewsById = new Map(Object.entries(snapshot.roomPreviews));
          this.snapshot = snapshot;
          this.roomPopulationsById = new Map(Object.entries(snapshot.roomPopulations));
          this.roomEditorsById = new Map(Object.entries(snapshot.roomEditors));
          this.syncGhostRenderers();
          this.refreshGhostVisibility();
          if (roomActivityChanged) {
            this.options.onRoomActivityChanged?.();
          }
          this.options.onSnapshotUpdated?.();
        };
        if (this.options.measurePerformance) {
          this.options.measurePerformance('presence.snapshot', reconcileSnapshot);
        } else {
          reconcileSnapshot();
        }
      },
    });
  }

  refreshIdentity(): boolean {
    const config = resolveWorldPresenceConfig();
    const nextIdentity = config ? resolveWorldPresenceIdentity() : null;
    const currentIdentity = this.identity;
    const existingBounds = this.subscribedChunkBounds ? { ...this.subscribedChunkBounds } : null;

    if (!config) {
      if (!this.client && !currentIdentity) {
        return false;
      }

      this.destroy();
      this.snapshot = {
        enabled: false,
        status: 'disabled',
        subscribedShards: [],
        connectedShards: [],
        publishedShard: null,
        ghosts: [],
        roomPopulations: {},
        roomEditors: {},
        roomPreviews: {},
      };
      this.roomPopulationsById = new Map();
      this.roomEditorsById = new Map();
      this.roomPreviewsById = new Map();
      this.options.onSnapshotUpdated?.();
      this.options.onRoomActivityChanged?.();
      return true;
    }

    if (
      currentIdentity &&
      nextIdentity &&
      currentIdentity.userId === nextIdentity.userId &&
      currentIdentity.displayName === nextIdentity.displayName &&
      currentIdentity.avatarId === nextIdentity.avatarId
    ) {
      return false;
    }

    this.destroy();
    this.initialize();
    if (existingBounds) {
      this.setSubscribedChunkBounds(existingBounds);
    }
    return true;
  }

  reset(): void {
    this.destroy();
    this.identity = null;
    this.snapshot = null;
    this.roomPopulationsById = new Map();
    this.roomEditorsById = new Map();
    this.roomPreviewsById = new Map();
    this.subscribedChunkBounds = null;
    this.subscribedBoundsRetainUntil = 0;
    this.ghostRenderBudget = 0;
    this.visibleGhostCount = 0;
    this.localRosterPresence = null;
    this.localPresenceDeadlineSnapshot = null;
    this.lastLocalPresenceForwardedAt = 0;
    this.hasForwardedLocalPresence = false;
    this.pvpMatchSnapshot = null;
    this.pvpLocalUserId = null;
    this.pvpInstanceOpponentUserId = null;
  }

  destroy(): void {
    this.client?.destroy();
    this.client = null;
    this.destroyGhostRenderers();
    this.roomPopulationsById = new Map();
    this.roomEditorsById = new Map();
    this.roomPreviewsById = new Map();
    this.snapshot = null;
    this.identity = null;
    this.subscribedChunkBounds = null;
    this.subscribedBoundsRetainUntil = 0;
    this.ghostRenderBudget = 0;
    this.visibleGhostCount = 0;
    this.localRosterPresence = null;
    this.localPresenceDeadlineSnapshot = null;
    this.lastLocalPresenceForwardedAt = 0;
    this.hasForwardedLocalPresence = false;
    this.pvpMatchSnapshot = null;
    this.pvpLocalUserId = null;
    this.pvpInstanceOpponentUserId = null;
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

  getRoomPreviewsById(): Map<string, WorldPresenceRoomPreview> {
    return this.roomPreviewsById;
  }

  getRenderedGhostsByConnectionId(): Map<string, RenderedGhost> {
    return this.renderedGhostsByConnectionId;
  }

  setPvpMatchSnapshot(snapshot: PvpMatchSnapshot | null, localUserId: string | null): void {
    this.pvpMatchSnapshot = snapshot && snapshot.status !== 'complete' ? snapshot : null;
    this.pvpLocalUserId = localUserId;
    this.syncRenderedGhostLabels();
    this.syncRenderedGhostPvpPresentation();
    this.refreshGhostVisibility();
  }

  setPvpInstanceOpponentUserId(userId: string | null): void {
    this.pvpInstanceOpponentUserId = userId;
    this.refreshGhostVisibility();
  }

  sendPvpInvite(
    targetConnectionId: string,
    invite: Omit<PvpInviteSendMessage['invite'], 'targetConnectionId' | 'target'>,
  ): boolean {
    if (!this.client || !this.snapshot?.enabled) {
      return false;
    }

    const target = (this.snapshot.ghosts ?? []).find((ghost) => ghost.connectionId === targetConnectionId);
    if (!target) {
      return false;
    }

    return this.client.sendPvpInvite(target, invite);
  }

  acceptPvpInvite(invite: PvpInviteOffer): boolean {
    return this.client?.sendPvpInviteAccept(invite) ?? false;
  }

  declinePvpInvite(invite: PvpInviteOffer): boolean {
    return this.client?.sendPvpInviteDecline(invite) ?? false;
  }

  setSubscribedChunkBounds(bounds: WorldChunkBounds | null): void {
    if (!this.client || !bounds) {
      return;
    }

    if (this.subscribedChunkBounds && areWorldChunkBoundsEqual(this.subscribedChunkBounds, bounds)) {
      return;
    }

    const now = Date.now();
    if (
      this.subscribedChunkBounds &&
      containsWorldChunkBounds(this.subscribedChunkBounds, bounds) &&
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

  isLocalPresenceDue(
    input: LocalPresenceInput | null,
    force = false,
    now = Date.now(),
  ): boolean {
    if (!this.client) {
      return false;
    }
    if (force || !this.hasForwardedLocalPresence) {
      return true;
    }
    const previous = this.localPresenceDeadlineSnapshot;
    if (!input) {
      return previous !== null;
    }
    if (!previous) {
      return true;
    }

    const pvpMatchId = input.pvp?.matchId ?? '';
    const pvpAction = input.pvp?.action ?? null;
    const pvpActionUntilBucket = Math.round((input.pvp?.actionUntil ?? 0) / 50);
    if (
      input.mode !== previous.mode
      || input.roomCoordinates.x !== previous.roomX
      || input.roomCoordinates.y !== previous.roomY
      || pvpMatchId !== previous.pvpMatchId
      || pvpAction !== previous.pvpAction
      || pvpActionUntilBucket !== previous.pvpActionUntilBucket
    ) {
      return true;
    }

    const changed =
      Math.round(input.x) !== previous.x
      || Math.round(input.y) !== previous.y
      || Math.round(input.velocityX) !== previous.velocityX
      || Math.round(input.velocityY) !== previous.velocityY
      || input.facing !== previous.facing
      || input.animationState !== previous.animationState;
    const interval = changed ? (pvpMatchId ? 25 : 200) : 5_000;
    return now - this.lastLocalPresenceForwardedAt >= interval;
  }

  updateLocalPresence(input: LocalPresenceInput | null, now = Date.now()): void {
    this.hasForwardedLocalPresence = true;
    this.lastLocalPresenceForwardedAt = now;
    this.localPresenceDeadlineSnapshot = input
      ? {
          mode: input.mode,
          roomX: input.roomCoordinates.x,
          roomY: input.roomCoordinates.y,
          x: Math.round(input.x),
          y: Math.round(input.y),
          velocityX: Math.round(input.velocityX),
          velocityY: Math.round(input.velocityY),
          facing: input.facing,
          animationState: input.animationState,
          pvpMatchId: input.pvp?.matchId ?? '',
          pvpAction: input.pvp?.action ?? null,
          pvpActionUntilBucket: Math.round((input.pvp?.actionUntil ?? 0) / 50),
        }
      : null;
    this.localRosterPresence = input
      ? {
          mode: input.mode,
          roomCoordinates: { ...input.roomCoordinates },
        }
      : null;

    if (!this.client || !input) {
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
      mode: input.mode,
      pvp: input.pvp ?? null,
      timestamp: now,
    });
  }

  updateGhosts(delta: number): void {
    const defaultStep = Math.min(1, delta / 90);
    const pvpStep = Math.min(1, delta / 30);
    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      const pvpRealtime = this.isGhostInActivePvp(renderedGhost.presence);
      let targetX = renderedGhost.targetX;
      let targetY = renderedGhost.targetY;
      if (pvpRealtime) {
        this.writePredictedGhostTarget(
          renderedGhost.presence,
          this.predictedGhostTargetScratch,
        );
        targetX = this.predictedGhostTargetScratch.x;
        targetY = this.predictedGhostTargetScratch.y;
      }
      const distance = Phaser.Math.Distance.Between(
        renderedGhost.sprite.x,
        renderedGhost.sprite.y,
        targetX,
        targetY,
      );
      const step = pvpRealtime ? pvpStep : defaultStep;
      if (pvpRealtime && distance > 72) {
        renderedGhost.sprite.setPosition(targetX, targetY);
      } else {
        renderedGhost.sprite.x = Phaser.Math.Linear(renderedGhost.sprite.x, targetX, step);
        renderedGhost.sprite.y = Phaser.Math.Linear(renderedGhost.sprite.y, targetY, step);
      }
      renderedGhost.halo.x = renderedGhost.sprite.x;
      renderedGhost.halo.y = renderedGhost.sprite.y - 2;
      renderedGhost.label.setPosition(renderedGhost.sprite.x, renderedGhost.sprite.y - 28);
      this.syncRenderedGhostActionIndicator(renderedGhost);
    }
  }

  refreshGhostVisibility(): void {
    this.syncGhostRenderers();
    const showGhosts = this.options.getMode() === 'play';
    let visibleGhostCount = 0;
    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      const avatarReady = this.isGhostAvatarRenderReady(renderedGhost.presence.avatarId);
      const pvpParticipant = this.isGhostInActivePvp(renderedGhost.presence);
      const hiddenByPvpInstance =
        Boolean(this.pvpInstanceOpponentUserId) &&
        renderedGhost.presence.userId === this.pvpInstanceOpponentUserId;
      const visible =
        showGhosts &&
        !hiddenByPvpInstance &&
        avatarReady &&
        this.options.isFullRoomLoaded(renderedGhost.presence.roomId) &&
        this.isPresenceFresh(renderedGhost.presence.timestamp);
      this.syncRenderedGhostPvpPresentation(renderedGhost);
      renderedGhost.halo.setVisible(visible && !pvpParticipant);
      renderedGhost.sprite.setVisible(visible);
      renderedGhost.label.setVisible(visible);
      if (!visible || !this.isGhostActionVisible(renderedGhost.presence)) {
        this.setRenderedGhostActionVisible(renderedGhost, false);
      }
      if (visible) {
        visibleGhostCount += 1;
      }
    }
    this.visibleGhostCount = visibleGhostCount;
  }

  getRoomPopulation(coordinates: RoomCoordinates): number {
    return this.roomPopulationsById.get(roomIdFromCoordinates(coordinates)) ?? 0;
  }

  getRoomEditorCount(coordinates: RoomCoordinates): number {
    return this.roomEditorsById.get(roomIdFromCoordinates(coordinates)) ?? 0;
  }

  getRoomEditorDisplayNames(coordinates: RoomCoordinates): string[] {
    if (!this.snapshot?.enabled) {
      return [];
    }

    const roomId = roomIdFromCoordinates(coordinates);
    const names = new Set<string>();

    for (const ghost of this.snapshot.ghosts ?? []) {
      if (
        ghost.mode !== 'edit' ||
        ghost.roomId !== roomId ||
        !this.isPresenceFresh(ghost.timestamp) ||
        !ghost.displayName.trim()
      ) {
        continue;
      }

      names.add(ghost.displayName.trim());
    }

    return [...names].sort((left, right) => left.localeCompare(right));
  }

  getTotalPlayerCount(): number | null {
    if (!this.snapshot?.enabled) {
      return null;
    }

    return this.getOnlineRoster().length;
  }

  getOnlineRoster(): OnlineRosterEntry[] {
    if (!this.snapshot?.enabled) {
      return [];
    }

    const entries: OnlineRosterEntry[] = (this.snapshot.ghosts ?? [])
      .filter((ghost) => this.isPresenceFresh(ghost.timestamp))
      .sort((left, right) => {
        const leftModeOrder = this.getOnlineRosterModeOrder(left.mode);
        const rightModeOrder = this.getOnlineRosterModeOrder(right.mode);
        if (leftModeOrder !== rightModeOrder) {
          return leftModeOrder - rightModeOrder;
        }

        if (left.timestamp !== right.timestamp) {
          return right.timestamp - left.timestamp;
        }

        return left.displayName.localeCompare(right.displayName);
      })
      .map((ghost) => ({
        key: ghost.connectionId,
        userId: ghost.userId,
        displayName: ghost.displayName,
        roomId: ghost.roomId,
        roomCoordinates: { ...ghost.roomCoordinates },
        mode: ghost.mode,
        isSelf: false,
      }));

    const selfEntry = this.getSelfOnlineRosterEntry();
    if (selfEntry) {
      entries.unshift(selfEntry);
    }

    return entries.sort((left, right) => {
      const leftModeOrder = this.getOnlineRosterModeOrder(left.mode);
      const rightModeOrder = this.getOnlineRosterModeOrder(right.mode);
      if (leftModeOrder !== rightModeOrder) {
        return leftModeOrder - rightModeOrder;
      }

      if (left.isSelf !== right.isSelf) {
        return left.isSelf ? -1 : 1;
      }

      return left.displayName.localeCompare(right.displayName);
    });
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
    roomPreviews: Record<string, {
      displayName: string;
      timestamp: number;
      updatedAt: string;
    }>;
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
      roomPreviews: Object.fromEntries(
        Array.from(this.roomPreviewsById.entries()).sort(([left], [right]) =>
          left.localeCompare(right)
        ).map(([roomId, preview]) => [
          roomId,
          {
            displayName: preview.displayName,
            timestamp: preview.timestamp,
            updatedAt: preview.snapshot.updatedAt,
          },
        ])
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
    maxDots = BROWSE_PRESENCE_DOT_MAX_TOTAL,
    perRoomLimit = BROWSE_PRESENCE_DOT_MAX_PER_ROOM,
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

      if (existing.presence.avatarId !== ghost.avatarId) {
        this.destroyRenderedGhost(existing);
        this.renderedGhostsByConnectionId.set(ghost.connectionId, this.createRenderedGhost(ghost));
        structureChanged = true;
        continue;
      }

      existing.presence = ghost;
      existing.targetX = ghost.x;
      existing.targetY = ghost.y;
      existing.sprite.setFlipX(ghost.facing < 0);
      this.syncRenderedGhostLabel(existing);
      this.syncRenderedGhostPvpPresentation(existing);
      this.ensureGhostAvatarPackLoaded(ghost.avatarId);
      if (!this.isGhostAvatarRenderReady(ghost.avatarId)) {
        continue;
      }
      const playerAvatarPack = resolvePlayerAvatarPack(ghost.avatarId);
      const animationKey = playerAvatarPack.animationKeys[ghost.animationState];
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
    }
  }

  private syncRenderedGhostLabels(): void {
    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      this.syncRenderedGhostLabel(renderedGhost);
      this.syncRenderedGhostPvpPresentation(renderedGhost);
    }
  }

  private syncRenderedGhostPvpPresentation(renderedGhost?: RenderedGhost): void {
    if (renderedGhost) {
      this.applyRenderedGhostPvpPresentation(renderedGhost);
      return;
    }
    for (const ghost of this.renderedGhostsByConnectionId.values()) {
      this.applyRenderedGhostPvpPresentation(ghost);
    }
  }

  private applyRenderedGhostPvpPresentation(ghost: RenderedGhost): void {
    const pvpParticipant = this.isGhostInActivePvp(ghost.presence);
    if (ghost.pvpPresentationActive === pvpParticipant) {
      return;
    }
    ghost.pvpPresentationActive = pvpParticipant;
    ghost.sprite.setAlpha(pvpParticipant ? 1 : 0.74);
    ghost.halo.setAlpha(pvpParticipant ? 0 : 1);
    ghost.label.setAlpha(pvpParticipant ? 1 : 0.94);
    ghost.label.setColor(pvpParticipant ? '#ff3f5f' : '#f3eee2');
    ghost.label.setStroke('#050505', pvpParticipant ? 4 : 3);
    ghost.label.setBackgroundColor(pvpParticipant ? 'rgba(0,0,0,0)' : '#050505');
  }

  private syncRenderedGhostLabel(renderedGhost: RenderedGhost): void {
    const nextText = this.getGhostLabelText(renderedGhost.presence);
    if (renderedGhost.cachedLabelText === nextText) {
      return;
    }
    renderedGhost.cachedLabelText = nextText;
    renderedGhost.label.setText(nextText);
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

    const currentRoomId =
      this.options.getMode() === 'play'
        ? roomIdFromCoordinates(this.options.getCurrentRoomCoordinates())
        : null;

    return [...(this.snapshot?.ghosts ?? [])]
      .filter((ghost) =>
        ghost.mode === 'play' ||
        (
          ghost.mode === 'edit' &&
          currentRoomId !== null &&
          ghost.roomId === currentRoomId &&
          this.options.isConstructionRoomLoaded(ghost.roomId)
        )
      )
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

  private getSelfOnlineRosterEntry(): OnlineRosterEntry | null {
    if (!this.identity || !this.localRosterPresence) {
      return null;
    }

    return {
      key: `self:${this.identity.userId}`,
      userId: this.identity.userId,
      displayName: this.identity.displayName,
      roomId: roomIdFromCoordinates(this.localRosterPresence.roomCoordinates),
      roomCoordinates: { ...this.localRosterPresence.roomCoordinates },
      mode: this.localRosterPresence.mode,
      isSelf: true,
    };
  }

  private getOnlineRosterModeOrder(mode: WorldGhostPresence['mode']): number {
    switch (mode) {
      case 'play':
        return 0;
      case 'edit':
        return 1;
      case 'browse':
      default:
        return 2;
    }
  }

  private getGhostLabelText(ghost: WorldGhostPresence): string {
    const participant = this.getPvpParticipant(ghost.userId);
    if (participant && this.isGhostInActivePvp(ghost)) {
      return participant.hearts > 0 ? '♥'.repeat(participant.hearts) : '0♥';
    }

    return ghost.displayName;
  }

  private isGhostInActivePvp(ghost: WorldGhostPresence): boolean {
    const snapshot = this.pvpMatchSnapshot;
    if (!snapshot || snapshot.status === 'complete' || ghost.userId === this.pvpLocalUserId) {
      return false;
    }

    if (!this.getPvpParticipant(ghost.userId)) {
      return false;
    }

    return !ghost.pvp?.matchId || ghost.pvp.matchId === snapshot.matchId;
  }

  private getPvpParticipant(userId: string): PvpMatchSnapshot['participants'][number] | null {
    return this.pvpMatchSnapshot?.participants.find((participant) => participant.userId === userId) ?? null;
  }

  private writePredictedGhostTarget(
    ghost: WorldGhostPresence,
    target: { x: number; y: number },
  ): void {
    const ageMs = Phaser.Math.Clamp(Date.now() - ghost.timestamp, 0, 100);
    const ageSeconds = ageMs / 1000;
    target.x = ghost.x + ghost.velocityX * ageSeconds;
    target.y = ghost.y + ghost.velocityY * ageSeconds;
  }

  private isGhostActionVisible(ghost: WorldGhostPresence): boolean {
    const pvp = ghost.pvp;
    if (
      !this.isGhostInActivePvp(ghost) ||
      !pvp ||
      pvp.matchId !== this.pvpMatchSnapshot?.matchId ||
      !pvp.action
    ) {
      return false;
    }

    return Date.now() < pvp.actionUntil;
  }

  private syncRenderedGhostActionIndicator(renderedGhost: RenderedGhost): void {
    const action = renderedGhost.presence.pvp?.action ?? null;
    if (!renderedGhost.sprite.visible || !this.isGhostActionVisible(renderedGhost.presence) || !action) {
      this.setRenderedGhostActionVisible(renderedGhost, false);
      return;
    }

    const facing = renderedGhost.presence.facing < 0 ? -1 : 1;
    this.setRenderedGhostActionVisible(renderedGhost, true);
    if (action === 'sword') {
      renderedGhost.actionIndicator
        .setPosition(renderedGhost.sprite.x + facing * 17, renderedGhost.sprite.y - 22)
        .setSize(24, 4)
        .setScale(1, 1)
        .setFillStyle(0xfff0b3, 0.96)
        .setAngle(facing * -28);
      renderedGhost.actionAccent
        .setPosition(renderedGhost.sprite.x + facing * 8, renderedGhost.sprite.y - 18)
        .setSize(7, 7)
        .setScale(1, 1)
        .setFillStyle(0xff3f5f, 0.95)
        .setAngle(0);
      renderedGhost.actionProjectile.setVisible(false);
      return;
    }

    renderedGhost.actionIndicator
      .setPosition(renderedGhost.sprite.x + facing * 14, renderedGhost.sprite.y - 20)
      .setSize(14, 4)
      .setScale(1, 1)
      .setFillStyle(0xd7faff, 0.96)
      .setAngle(0);
    renderedGhost.actionAccent
      .setPosition(renderedGhost.sprite.x + facing * 24, renderedGhost.sprite.y - 20)
      .setSize(6, 6)
      .setScale(1, 1)
      .setFillStyle(0xfff0b3, 0.96)
      .setAngle(0);
    renderedGhost.actionProjectile
      .setVisible(true)
      .setPosition(renderedGhost.sprite.x + facing * 40, renderedGhost.sprite.y - 20)
      .setSize(18, 3)
      .setScale(1, 1)
      .setFillStyle(0x7de3ff, 0.96)
      .setAngle(0);
  }

  private setRenderedGhostActionVisible(renderedGhost: RenderedGhost, visible: boolean): void {
    renderedGhost.actionIndicator.setVisible(visible);
    renderedGhost.actionAccent.setVisible(visible);
    renderedGhost.actionProjectile.setVisible(visible);
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

  private createRenderedGhost(ghost: WorldGhostPresence): RenderedGhost {
    this.ensureGhostAvatarPackLoaded(ghost.avatarId);
    const avatarReady = this.isGhostAvatarRenderReady(ghost.avatarId);
    const playerAvatarPack = resolvePlayerAvatarPack(avatarReady ? ghost.avatarId : null);
    const halo = this.options.scene.add.ellipse(ghost.x, ghost.y - 2, 18, 8, 0xffffff, 0.28);
    halo.setDepth(22);

    const sprite = this.options.scene.add.sprite(
      ghost.x,
      ghost.y,
      playerAvatarPack.idleTextureKey,
      playerAvatarPack.idleFrame
    );
    sprite.setOrigin(0.5, 1);
    sprite.setAlpha(0.74);
    sprite.setDepth(24);
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    sprite.setFlipX(ghost.facing < 0);
    if (avatarReady) {
      sprite.play(playerAvatarPack.animationKeys[ghost.animationState]);
    } else {
      sprite.setVisible(false);
    }

    const label = this.options.scene.add.text(ghost.x, ghost.y - 28, this.getGhostLabelText(ghost), {
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

    const actionIndicator = this.options.scene.add.rectangle(ghost.x, ghost.y - 18, 20, 4, 0xffd65a, 0);
    actionIndicator.setDepth(27);
    actionIndicator.setVisible(false);
    const actionAccent = this.options.scene.add.rectangle(ghost.x, ghost.y - 18, 7, 7, 0xff3f5f, 0);
    actionAccent.setDepth(28);
    actionAccent.setVisible(false);
    const actionProjectile = this.options.scene.add.rectangle(ghost.x, ghost.y - 18, 18, 3, 0x7de3ff, 0);
    actionProjectile.setDepth(28);
    actionProjectile.setVisible(false);

    const renderedGhost: RenderedGhost = {
      presence: ghost,
      halo,
      sprite,
      label,
      actionIndicator,
      actionAccent,
      actionProjectile,
      targetX: ghost.x,
      targetY: ghost.y,
      cachedLabelText: this.getGhostLabelText(ghost),
      pvpPresentationActive: null,
    };
    this.syncRenderedGhostPvpPresentation(renderedGhost);
    return renderedGhost;
  }

  private destroyGhostRenderers(): void {
    if (this.renderedGhostsByConnectionId.size === 0) {
      return;
    }

    for (const renderedGhost of this.renderedGhostsByConnectionId.values()) {
      this.destroyRenderedGhost(renderedGhost);
    }
    this.renderedGhostsByConnectionId.clear();
  }

  private destroyRenderedGhost(renderedGhost: RenderedGhost): void {
    renderedGhost.halo.destroy();
    renderedGhost.sprite.destroy();
    renderedGhost.label.destroy();
    renderedGhost.actionIndicator.destroy();
    renderedGhost.actionAccent.destroy();
    renderedGhost.actionProjectile.destroy();
  }

  private ensureGhostAvatarPackLoaded(avatarId: string): void {
    if (this.isGhostAvatarRenderReady(avatarId) || this.pendingGhostAvatarLoads.has(avatarId)) {
      return;
    }

    this.pendingGhostAvatarLoads.add(avatarId);
    void ensureSceneAvatarPackLoaded(this.options.scene, avatarId)
      .then((pack) => {
        if (pack.id !== avatarId) {
          return;
        }
        this.refreshGhostVisibility();
      })
      .catch((error) => {
        console.warn('Failed to load ghost avatar pack.', avatarId, error);
      })
      .finally(() => {
        this.pendingGhostAvatarLoads.delete(avatarId);
      });
  }

  private isGhostAvatarRenderReady(avatarId: string): boolean {
    if (!getRegisteredPlayerAvatarPack(avatarId) && !isDynamicPlayerAvatarId(avatarId)) {
      return true;
    }

    return isSceneAvatarPackLoaded(this.options.scene, avatarId);
  }

  private isPresenceFresh(timestamp: number): boolean {
    return Date.now() - timestamp <= OverworldPresenceController.PRESENCE_STALE_MS;
  }
}
