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
  getCurrentRoomCoordinates(): RoomCoordinates;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  getWindowCenterCoordinates(): RoomCoordinates;
  getRoomCoordinatesForPoint(x: number, y: number): RoomCoordinates;
  isNeighborReachable(roomCoordinates: RoomCoordinates, neighborCoordinates: RoomCoordinates): boolean;
  prefetchPlayableRoomForTransition(coordinates: RoomCoordinates): void;
  preparePlayableRoomForTransition(coordinates: RoomCoordinates): boolean;
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
    }
  ): void;
  redrawWorld(): void;
  renderHud(): void;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  clearLadderState(): void;
  syncPlayerPickupSensor(): void;
}

interface SafePlayerTransform {
  valid: boolean;
  roomX: number;
  roomY: number;
  x: number;
  y: number;
}

const TRANSITION_PREFETCH_DISTANCE_PX = 192;
const TRANSITION_PREPARE_DISTANCE_PX = 72;
const MOVEMENT_EPSILON = 1;

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

  constructor(private readonly host: OverworldRoomTransitionHost) {}

  authorizeTeleportTransition(coordinates: RoomCoordinates): void {
    this.authorizedTeleportDestination = { ...coordinates };
  }

  maybeAdvancePlayerRoom(): void {
    if (this.host.getMode() !== 'play') {
      this.lastSafePlayerTransform.valid = false;
      this.clearPendingPreparation();
      this.authorizedTeleportDestination = null;
      return;
    }

    const player = this.host.getPlayer();
    if (!player) {
      this.lastSafePlayerTransform.valid = false;
      this.clearPendingPreparation();
      this.authorizedTeleportDestination = null;
      return;
    }
    this.transitionRoomPreparedThisUpdate = false;

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
      this.pollPendingPreparations(currentRoomCoordinates, player);
      this.prepareApproachingNeighbors(currentRoomCoordinates, player, this.host.getPlayerBody());
      this.authorizedTeleportDestination = null;
      return;
    }

    const authorizedTeleport = this.consumeAuthorizedTeleport(nextRoomCoordinates);
    if (
      this.shouldBlockRoomTransition(
        currentRoomCoordinates,
        nextRoomCoordinates,
        authorizedTeleport,
      )
    ) {
      if (!this.isCardinalNeighbor(currentRoomCoordinates, nextRoomCoordinates)) {
        this.restoreLastSafePlayerTransform(currentRoomCoordinates);
      } else {
        this.blockRoomTransition(currentRoomCoordinates, nextRoomCoordinates);
      }
      return;
    }

    if (!this.host.preparePlayableRoomForTransition(nextRoomCoordinates)) {
      if (this.isCardinalNeighbor(currentRoomCoordinates, nextRoomCoordinates)) {
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
    this.host.updateSelectedSummary();

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

    this.host.prefetchPlayableRoomForTransition(neighborCoordinates);
    if (distanceToSeam <= TRANSITION_PREPARE_DISTANCE_PX) {
      this.setPendingPreparation(currentRoomCoordinates, neighborCoordinates);
      if (
        !this.transitionRoomPreparedThisUpdate
        && this.host.preparePlayableRoomForTransition(neighborCoordinates)
      ) {
        this.transitionRoomPreparedThisUpdate = true;
        this.clearPendingPreparationFor(neighborCoordinates);
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

    this.host.prefetchPlayableRoomForTransition(neighborCoordinates);
    if (distanceToSeam <= TRANSITION_PREPARE_DISTANCE_PX) {
      if (
        !this.transitionRoomPreparedThisUpdate
        && this.host.preparePlayableRoomForTransition(neighborCoordinates)
      ) {
        this.transitionRoomPreparedThisUpdate = true;
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

  private consumeAuthorizedTeleport(nextRoomCoordinates: RoomCoordinates): boolean {
    const destination = this.authorizedTeleportDestination;
    this.authorizedTeleportDestination = null;
    return Boolean(
      destination
      && destination.x === nextRoomCoordinates.x
      && destination.y === nextRoomCoordinates.y
    );
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
