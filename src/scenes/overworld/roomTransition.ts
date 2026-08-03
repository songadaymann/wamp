import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../../config';
import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';

interface OverworldRoomTransitionHost {
  getMode(): 'browse' | 'play';
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  getPlayerFacing(): -1 | 1;
  getCurrentRoomCoordinates(): RoomCoordinates;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  getWindowCenterCoordinates(): RoomCoordinates;
  getRoomCoordinatesForPoint(x: number, y: number): RoomCoordinates;
  isNeighborReachable(roomCoordinates: RoomCoordinates, neighborCoordinates: RoomCoordinates): boolean;
  prefetchPlayableRoomForTransition(coordinates: RoomCoordinates): void;
  clearPredictedPlayableRoomForTransition(): void;
  preparePlayableRoomForTransition(coordinates: RoomCoordinates, portalDestination?: boolean): boolean;
  isRoomTransitionLocked(): boolean;
  resetChallengeStateForRoomExit(nextRoomCoordinates: RoomCoordinates): void;
  updateSelectedSummary(): void;
  getActiveCourseRun(): unknown | null;
  syncGoalRunForRoom(room: RoomSnapshot | null, entryContext?: 'transition' | 'spawn' | 'respawn'): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  refreshLeaderboardForSelection(): Promise<void>;
  refreshCourseComposerSelectedRoomState(): Promise<void>;
  setFocusedCoordinates(coordinates: RoomCoordinates): void;
  getActiveRoomRushRun(): unknown | null;
  recordRoomRushVisit(room: RoomSnapshot | null): void;
  refreshAround(coordinates: RoomCoordinates): Promise<unknown>;
  refreshAroundIfNeededOrFromCache(
    coordinates: RoomCoordinates,
    options?: {
      forceChunkReload?: boolean;
      refreshLeaderboards?: boolean;
      preferCachedWindow?: boolean;
      focusChangeFrom?: RoomCoordinates;
    }
  ): void;
  redrawWorld(): void;
  renderHud(): void;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  clearLadderState(): void;
  syncPlayerPickupSensor(): void;
  getTransitionDebugContext?(coordinates: RoomCoordinates): Record<string, unknown>;
  setTransitionPreparationSeamUrgent?(urgent: boolean): void;
  recordPerformanceTransitionGate?(
    reason: BlockedTransitionReason,
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates,
  ): void;
  clearPerformanceTransitionGate?(): void;
  onRoomTransitionCompleted?(): void;
}

type BlockedTransitionReason = 'locked' | 'unreachable' | 'non-cardinal' | 'unprepared';

interface SafePlayerTransform {
  valid: boolean;
  roomX: number;
  roomY: number;
  x: number;
  y: number;
}

interface ActiveUnpreparedTransition {
  readonly from: RoomCoordinates;
  readonly to: RoomCoordinates;
}

// Start exact-snapshot preparation as soon as movement predicts a cardinal
// destination anywhere in the current room. The coordinator still limits the
// actual work, while the full-room lead time keeps normal runs off the seam.
const TRANSITION_PREFETCH_DISTANCE_PX = Math.max(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
const TRANSITION_PREPARE_DISTANCE_PX = 72;
const MOVEMENT_EPSILON = 1;
const BLOCKED_TRANSITION_LOG_INTERVAL_MS = 1_000;

export class OverworldRoomTransitionController {
  private readonly lastSafePlayerTransform: SafePlayerTransform = {
    valid: false,
    roomX: 0,
    roomY: 0,
    x: 0,
    y: 0,
  };
  private pendingHorizontalPreparation: RoomCoordinates | null = null;
  private pendingVerticalPreparation: RoomCoordinates | null = null;
  private authorizedTeleportDestination: RoomCoordinates | null = null;
  private transitionRoomPreparedThisUpdate = false;
  private predictedRoomRequestedThisUpdate = false;
  private lastBlockedLogKey = '';
  private lastBlockedLogAt = 0;
  private activeUnpreparedTransition: ActiveUnpreparedTransition | null = null;

  constructor(private readonly host: OverworldRoomTransitionHost) {}

  authorizeTeleportTransition(coordinates: RoomCoordinates): void {
    this.authorizedTeleportDestination = { ...coordinates };
  }

  maybeAdvancePlayerRoom(): void {
    this.host.setTransitionPreparationSeamUrgent?.(false);
    if (this.host.getMode() !== 'play') {
      this.lastSafePlayerTransform.valid = false;
      this.clearPendingPreparation();
      this.host.clearPredictedPlayableRoomForTransition();
      this.clearActiveUnpreparedTransition();
      this.authorizedTeleportDestination = null;
      return;
    }

    const player = this.host.getPlayer();
    if (!player) {
      this.lastSafePlayerTransform.valid = false;
      this.clearPendingPreparation();
      this.host.clearPredictedPlayableRoomForTransition();
      this.clearActiveUnpreparedTransition();
      this.authorizedTeleportDestination = null;
      return;
    }
    this.transitionRoomPreparedThisUpdate = false;
    this.predictedRoomRequestedThisUpdate = false;

    const currentRoomCoordinates = this.host.getCurrentRoomCoordinates();
    const nextRoomCoordinates = this.host.getRoomCoordinatesForPoint(player.x, player.y);
    if (
      nextRoomCoordinates.x === currentRoomCoordinates.x &&
      nextRoomCoordinates.y === currentRoomCoordinates.y
    ) {
      this.lastSafePlayerTransform.valid = true;
      this.lastSafePlayerTransform.roomX = currentRoomCoordinates.x;
      this.lastSafePlayerTransform.roomY = currentRoomCoordinates.y;
      this.lastSafePlayerTransform.x = player.x;
      this.lastSafePlayerTransform.y = player.y;
      this.discardPendingPreparationsContraryToIntent(
        currentRoomCoordinates,
        player,
        this.host.getPlayerBody(),
      );
      this.pollPendingPreparations(currentRoomCoordinates, player);
      this.prepareApproachingNeighbors(currentRoomCoordinates, player, this.host.getPlayerBody());
      if (!this.predictedRoomRequestedThisUpdate) {
        this.host.clearPredictedPlayableRoomForTransition();
      }
      this.clearAbandonedUnpreparedTransition(currentRoomCoordinates);
      this.authorizedTeleportDestination = null;
      return;
    }

    this.host.setTransitionPreparationSeamUrgent?.(true);

    const authorizedTeleport = this.consumeAuthorizedTeleport(nextRoomCoordinates);
    if (
      this.shouldBlockRoomTransition(
        currentRoomCoordinates,
        nextRoomCoordinates,
        authorizedTeleport,
      )
    ) {
      this.host.clearPredictedPlayableRoomForTransition();
      const reason: BlockedTransitionReason = this.host.isRoomTransitionLocked()
        ? 'locked'
        : this.isCardinalNeighbor(currentRoomCoordinates, nextRoomCoordinates)
          ? 'unreachable'
          : 'non-cardinal';
      // The advisor owns clearing a prior unprepared stall when it receives a
      // different gate reason. Keep only the controller's intent bookkeeping
      // in sync here so we do not double-clear the same episode.
      this.activeUnpreparedTransition = null;
      this.host.recordPerformanceTransitionGate?.(
        reason,
        currentRoomCoordinates,
        nextRoomCoordinates,
      );
      this.logBlockedTransition(reason, currentRoomCoordinates, nextRoomCoordinates);
      if (!this.isCardinalNeighbor(currentRoomCoordinates, nextRoomCoordinates)) {
        this.restoreLastSafePlayerTransform(currentRoomCoordinates);
      } else {
        this.blockRoomTransition(currentRoomCoordinates, nextRoomCoordinates);
      }
      return;
    }

    const destinationPrepared = authorizedTeleport
      ? this.host.preparePlayableRoomForTransition(nextRoomCoordinates, true)
      : this.host.preparePlayableRoomForTransition(nextRoomCoordinates);
    if (!destinationPrepared) {
      this.retainUnpreparedTransition(currentRoomCoordinates, nextRoomCoordinates);
      this.host.recordPerformanceTransitionGate?.(
        'unprepared',
        currentRoomCoordinates,
        nextRoomCoordinates,
      );
      this.logBlockedTransition('unprepared', currentRoomCoordinates, nextRoomCoordinates);
      if (this.isCardinalNeighbor(currentRoomCoordinates, nextRoomCoordinates)) {
        this.setPendingPreparation(currentRoomCoordinates, nextRoomCoordinates);
        this.blockRoomTransition(currentRoomCoordinates, nextRoomCoordinates);
      } else {
        this.restoreLastSafePlayerTransform(currentRoomCoordinates);
      }
      return;
    }

    this.host.resetChallengeStateForRoomExit(nextRoomCoordinates);
    this.host.setCurrentRoomCoordinates(nextRoomCoordinates);
    this.host.setSelectedCoordinates(nextRoomCoordinates);
    this.lastSafePlayerTransform.valid = false;
    this.clearPendingPreparation();
    this.host.clearPredictedPlayableRoomForTransition();
    this.clearActiveUnpreparedTransition();
    this.host.updateSelectedSummary();
    this.host.onRoomTransitionCompleted?.();

    if (this.host.getActiveRoomRushRun()) {
      this.host.recordRoomRushVisit(
        this.host.getRoomSnapshotForCoordinates(nextRoomCoordinates),
      );
    } else if (!this.host.getActiveCourseRun()) {
      this.host.syncGoalRunForRoom(
        this.host.getRoomSnapshotForCoordinates(nextRoomCoordinates),
        'transition',
      );
      void this.host.refreshLeaderboardForSelection();
    }

    void this.host.refreshCourseComposerSelectedRoomState();
    this.host.setFocusedCoordinates(nextRoomCoordinates);

    const windowCenterCoordinates = this.host.getWindowCenterCoordinates();
    if (
      nextRoomCoordinates.x !== windowCenterCoordinates.x ||
      nextRoomCoordinates.y !== windowCenterCoordinates.y
    ) {
      this.host.refreshAroundIfNeededOrFromCache(nextRoomCoordinates, {
        refreshLeaderboards: false,
        preferCachedWindow: true,
        focusChangeFrom: currentRoomCoordinates,
      });
      return;
    }

    this.host.redrawWorld();
    this.host.renderHud();
  }

  isNeighborReachableInCurrentPlayMode(
    roomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates,
  ): boolean {
    return this.host.isNeighborReachable(roomCoordinates, neighborCoordinates);
  }

  private shouldBlockRoomTransition(
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates,
    allowNonCardinalTeleport = false,
  ): boolean {
    if (this.host.isRoomTransitionLocked()) {
      return true;
    }

    const deltaX = nextRoomCoordinates.x - currentRoomCoordinates.x;
    const deltaY = nextRoomCoordinates.y - currentRoomCoordinates.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) {
      return !allowNonCardinalTeleport;
    }

    return !this.isNeighborReachableInCurrentPlayMode(currentRoomCoordinates, nextRoomCoordinates);
  }

  private isCardinalNeighbor(
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates,
  ): boolean {
    return Math.abs(nextRoomCoordinates.x - currentRoomCoordinates.x)
      + Math.abs(nextRoomCoordinates.y - currentRoomCoordinates.y) === 1;
  }

  private prepareApproachingNeighbors(
    currentRoomCoordinates: RoomCoordinates,
    player: Phaser.GameObjects.Rectangle,
    playerBody: Phaser.Physics.Arcade.Body | null,
  ): void {
    if (!playerBody) {
      return;
    }

    const origin = this.host.getRoomOrigin(currentRoomCoordinates);
    if (playerBody.velocity.x > MOVEMENT_EPSILON) {
      this.prepareApproachingNeighbor(
        currentRoomCoordinates,
        { x: currentRoomCoordinates.x + 1, y: currentRoomCoordinates.y },
        origin.x + ROOM_PX_WIDTH - player.x,
      );
    } else if (playerBody.velocity.x < -MOVEMENT_EPSILON) {
      this.prepareApproachingNeighbor(
        currentRoomCoordinates,
        { x: currentRoomCoordinates.x - 1, y: currentRoomCoordinates.y },
        player.x - origin.x,
      );
    } else if (Math.abs(playerBody.velocity.y) <= MOVEMENT_EPSILON) {
      const facing = this.host.getPlayerFacing();
      this.prepareApproachingNeighbor(
        currentRoomCoordinates,
        { x: currentRoomCoordinates.x + facing, y: currentRoomCoordinates.y },
        facing > 0
          ? origin.x + ROOM_PX_WIDTH - player.x
          : player.x - origin.x,
      );
    }

    if (playerBody.velocity.y > MOVEMENT_EPSILON) {
      this.prepareApproachingNeighbor(
        currentRoomCoordinates,
        { x: currentRoomCoordinates.x, y: currentRoomCoordinates.y + 1 },
        origin.y + ROOM_PX_HEIGHT - player.y,
      );
    } else if (playerBody.velocity.y < -MOVEMENT_EPSILON) {
      this.prepareApproachingNeighbor(
        currentRoomCoordinates,
        { x: currentRoomCoordinates.x, y: currentRoomCoordinates.y - 1 },
        player.y - origin.y,
      );
    }
  }

  private prepareApproachingNeighbor(
    currentRoomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates,
    distanceToSeam: number,
  ): void {
    if (
      distanceToSeam > TRANSITION_PREFETCH_DISTANCE_PX
      || !this.isNeighborReachableInCurrentPlayMode(currentRoomCoordinates, neighborCoordinates)
    ) {
      return;
    }

    this.predictedRoomRequestedThisUpdate = true;
    this.host.prefetchPlayableRoomForTransition(neighborCoordinates);
    if (distanceToSeam <= TRANSITION_PREPARE_DISTANCE_PX) {
      this.host.setTransitionPreparationSeamUrgent?.(true);
      this.setPendingPreparation(currentRoomCoordinates, neighborCoordinates);
      if (
        !this.transitionRoomPreparedThisUpdate
        && this.host.preparePlayableRoomForTransition(neighborCoordinates)
      ) {
        this.transitionRoomPreparedThisUpdate = true;
        this.clearPendingPreparationFor(neighborCoordinates);
        this.clearPreparedUnpreparedTransition(neighborCoordinates);
      }
    }
  }

  private pollPendingPreparations(
    currentRoomCoordinates: RoomCoordinates,
    player: Phaser.GameObjects.Rectangle,
  ): void {
    this.pendingHorizontalPreparation = this.pollPendingPreparation(
      currentRoomCoordinates,
      player,
      this.pendingHorizontalPreparation,
    );
    this.pendingVerticalPreparation = this.pollPendingPreparation(
      currentRoomCoordinates,
      player,
      this.pendingVerticalPreparation,
    );
  }

  private discardPendingPreparationsContraryToIntent(
    currentRoomCoordinates: RoomCoordinates,
    player: Phaser.GameObjects.Rectangle,
    playerBody: Phaser.Physics.Arcade.Body | null,
  ): void {
    if (!playerBody) {
      this.clearPendingPreparation();
      return;
    }

    const intendedHorizontalDirection = playerBody.velocity.x > MOVEMENT_EPSILON
      ? 1
      : playerBody.velocity.x < -MOVEMENT_EPSILON
        ? -1
        : this.host.getPlayerFacing();
    if (
      this.pendingHorizontalPreparation
      && (
        Math.sign(this.pendingHorizontalPreparation.x - currentRoomCoordinates.x)
          !== intendedHorizontalDirection
        || (
          Math.abs(playerBody.velocity.x) <= MOVEMENT_EPSILON
          && this.getDistanceToNeighborSeam(
            currentRoomCoordinates,
            this.pendingHorizontalPreparation,
            player,
          ) > TRANSITION_PREPARE_DISTANCE_PX
        )
      )
    ) {
      this.pendingHorizontalPreparation = null;
    }

    const intendedVerticalDirection = playerBody.velocity.y > MOVEMENT_EPSILON
      ? 1
      : playerBody.velocity.y < -MOVEMENT_EPSILON
        ? -1
        : 0;
    if (
      intendedVerticalDirection !== 0
      && this.pendingVerticalPreparation
      && Math.sign(this.pendingVerticalPreparation.y - currentRoomCoordinates.y)
        !== intendedVerticalDirection
    ) {
      this.pendingVerticalPreparation = null;
    }
    if (
      intendedVerticalDirection === 0
      && this.pendingVerticalPreparation
      && this.getDistanceToNeighborSeam(
        currentRoomCoordinates,
        this.pendingVerticalPreparation,
        player,
      ) > TRANSITION_PREPARE_DISTANCE_PX
    ) {
      this.pendingVerticalPreparation = null;
    }
  }

  private pollPendingPreparation(
    currentRoomCoordinates: RoomCoordinates,
    player: Phaser.GameObjects.Rectangle,
    neighborCoordinates: RoomCoordinates | null,
  ): RoomCoordinates | null {
    if (
      !neighborCoordinates
      || !this.isCardinalNeighbor(currentRoomCoordinates, neighborCoordinates)
      || !this.isNeighborReachableInCurrentPlayMode(currentRoomCoordinates, neighborCoordinates)
    ) {
      return null;
    }

    const distanceToSeam = this.getDistanceToNeighborSeam(
      currentRoomCoordinates,
      neighborCoordinates,
      player,
    );
    if (distanceToSeam > TRANSITION_PREFETCH_DISTANCE_PX) {
      return null;
    }

    this.predictedRoomRequestedThisUpdate = true;
    this.host.prefetchPlayableRoomForTransition(neighborCoordinates);
    if (distanceToSeam <= TRANSITION_PREPARE_DISTANCE_PX) {
      this.host.setTransitionPreparationSeamUrgent?.(true);
      if (
        !this.transitionRoomPreparedThisUpdate
        && this.host.preparePlayableRoomForTransition(neighborCoordinates)
      ) {
        this.transitionRoomPreparedThisUpdate = true;
        this.clearPreparedUnpreparedTransition(neighborCoordinates);
        return null;
      }
    }
    return neighborCoordinates;
  }

  private getDistanceToNeighborSeam(
    currentRoomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates,
    player: Phaser.GameObjects.Rectangle,
  ): number {
    const origin = this.host.getRoomOrigin(currentRoomCoordinates);
    const deltaX = neighborCoordinates.x - currentRoomCoordinates.x;
    const deltaY = neighborCoordinates.y - currentRoomCoordinates.y;
    if (deltaX === 1) return origin.x + ROOM_PX_WIDTH - player.x;
    if (deltaX === -1) return player.x - origin.x;
    if (deltaY === 1) return origin.y + ROOM_PX_HEIGHT - player.y;
    return player.y - origin.y;
  }

  private setPendingPreparation(
    currentRoomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates,
  ): void {
    if (neighborCoordinates.x !== currentRoomCoordinates.x) {
      this.pendingHorizontalPreparation = { ...neighborCoordinates };
    } else {
      this.pendingVerticalPreparation = { ...neighborCoordinates };
    }
  }

  private clearPendingPreparationFor(coordinates: RoomCoordinates): void {
    if (
      this.pendingHorizontalPreparation?.x === coordinates.x
      && this.pendingHorizontalPreparation.y === coordinates.y
    ) {
      this.pendingHorizontalPreparation = null;
    }
    if (
      this.pendingVerticalPreparation?.x === coordinates.x
      && this.pendingVerticalPreparation.y === coordinates.y
    ) {
      this.pendingVerticalPreparation = null;
    }
  }

  private clearPendingPreparation(): void {
    this.pendingHorizontalPreparation = null;
    this.pendingVerticalPreparation = null;
  }

  private retainUnpreparedTransition(
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates,
  ): void {
    const active = this.activeUnpreparedTransition;
    const sameEpisode = Boolean(
      active
      && active.from.x === currentRoomCoordinates.x
      && active.from.y === currentRoomCoordinates.y
      && active.to.x === nextRoomCoordinates.x
      && active.to.y === nextRoomCoordinates.y
    );
    if (sameEpisode) {
      return;
    }
    if (active) {
      this.clearActiveUnpreparedTransition();
    }
    this.activeUnpreparedTransition = {
      from: { ...currentRoomCoordinates },
      to: { ...nextRoomCoordinates },
    };
  }

  private clearPreparedUnpreparedTransition(coordinates: RoomCoordinates): void {
    const active = this.activeUnpreparedTransition;
    if (
      active
      && active.to.x === coordinates.x
      && active.to.y === coordinates.y
    ) {
      this.clearActiveUnpreparedTransition();
    }
  }

  private clearAbandonedUnpreparedTransition(
    currentRoomCoordinates: RoomCoordinates,
  ): void {
    const active = this.activeUnpreparedTransition;
    if (!active) {
      return;
    }
    const stillInSourceRoom =
      active.from.x === currentRoomCoordinates.x
      && active.from.y === currentRoomCoordinates.y;
    if (!stillInSourceRoom) {
      this.clearActiveUnpreparedTransition();
      return;
    }
    const replacementReason: BlockedTransitionReason | null =
      this.host.isRoomTransitionLocked()
        ? 'locked'
        : !this.isCardinalNeighbor(currentRoomCoordinates, active.to)
          ? 'non-cardinal'
          : !this.isNeighborReachableInCurrentPlayMode(currentRoomCoordinates, active.to)
            ? 'unreachable'
            : null;
    if (replacementReason) {
      this.activeUnpreparedTransition = null;
      this.host.recordPerformanceTransitionGate?.(
        replacementReason,
        currentRoomCoordinates,
        active.to,
      );
      return;
    }
    const stillPreparingDestination = this.hasPendingPreparationFor(active.to);
    if (!stillPreparingDestination) {
      this.clearActiveUnpreparedTransition();
    }
  }

  private hasPendingPreparationFor(coordinates: RoomCoordinates): boolean {
    return Boolean(
      (
        this.pendingHorizontalPreparation?.x === coordinates.x
        && this.pendingHorizontalPreparation.y === coordinates.y
      )
      || (
        this.pendingVerticalPreparation?.x === coordinates.x
        && this.pendingVerticalPreparation.y === coordinates.y
      )
    );
  }

  private clearActiveUnpreparedTransition(): void {
    if (!this.activeUnpreparedTransition) {
      return;
    }
    this.activeUnpreparedTransition = null;
    this.host.clearPerformanceTransitionGate?.();
  }

  private consumeAuthorizedTeleport(nextRoomCoordinates: RoomCoordinates): boolean {
    const destination = this.authorizedTeleportDestination;
    this.authorizedTeleportDestination = null;
    return Boolean(
      destination
      && destination.x === nextRoomCoordinates.x
      && destination.y === nextRoomCoordinates.y
    );
  }

  private logBlockedTransition(
    reason: BlockedTransitionReason,
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates,
  ): void {
    const key = `${reason}:${nextRoomCoordinates.x},${nextRoomCoordinates.y}`;
    const now = Date.now();
    if (key === this.lastBlockedLogKey && now < this.lastBlockedLogAt + BLOCKED_TRANSITION_LOG_INTERVAL_MS) {
      return;
    }
    this.lastBlockedLogKey = key;
    this.lastBlockedLogAt = now;
    console.warn(`[room-transition] blocked (${reason})`, {
      from: { ...currentRoomCoordinates },
      to: { ...nextRoomCoordinates },
      ...(this.host.getTransitionDebugContext?.(nextRoomCoordinates) ?? {}),
    });
  }

  private restoreLastSafePlayerTransform(currentRoomCoordinates: RoomCoordinates): void {
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    const transform = this.lastSafePlayerTransform;
    if (
      !player
      || !playerBody
      || !transform.valid
      || transform.roomX !== currentRoomCoordinates.x
      || transform.roomY !== currentRoomCoordinates.y
    ) {
      return;
    }

    this.host.clearLadderState();
    playerBody.reset(transform.x, transform.y);
    player.setPosition(transform.x, transform.y);
    this.host.syncPlayerPickupSensor();
  }

  private blockRoomTransition(
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates,
  ): void {
    const player = this.host.getPlayer();
    const playerBody = this.host.getPlayerBody();
    if (!player || !playerBody) {
      return;
    }

    const roomOrigin = this.host.getRoomOrigin(currentRoomCoordinates);
    const deltaX = nextRoomCoordinates.x - currentRoomCoordinates.x;
    const deltaY = nextRoomCoordinates.y - currentRoomCoordinates.y;
    const halfWidth = playerBody.width * 0.5;
    const halfHeight = playerBody.height * 0.5;
    const velocityX = playerBody.velocity.x;
    const velocityY = playerBody.velocity.y;
    const inset = 1;

    let nextX = player.x;
    let nextY = player.y;

    if (deltaX === 1) {
      nextX = roomOrigin.x + ROOM_PX_WIDTH - halfWidth - inset;
    } else if (deltaX === -1) {
      nextX = roomOrigin.x + halfWidth + inset;
    } else if (deltaY === 1) {
      nextY = roomOrigin.y + ROOM_PX_HEIGHT - halfHeight - inset;
    } else if (deltaY === -1) {
      nextY = roomOrigin.y + halfHeight + inset;
    }

    this.host.clearLadderState();
    playerBody.reset(nextX, nextY);
    playerBody.setVelocity(
      deltaX === 0 ? velocityX : 0,
      deltaY === 0 ? velocityY : 0,
    );
    player.setPosition(nextX, nextY);
    this.host.syncPlayerPickupSensor();
  }
}
