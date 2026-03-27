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
  resetChallengeStateForRoomExit(nextRoomCoordinates: RoomCoordinates): void;
  updateSelectedSummary(): void;
  getActiveCourseRun(): unknown | null;
  syncGoalRunForRoom(room: RoomSnapshot | null, entryContext?: 'transition' | 'spawn' | 'respawn'): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  refreshLeaderboardForSelection(): Promise<void>;
  refreshCourseComposerSelectedRoomState(): Promise<void>;
  setFocusedCoordinates(coordinates: RoomCoordinates): void;
  refreshAround(coordinates: RoomCoordinates): Promise<unknown>;
  redrawWorld(): void;
  renderHud(): void;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  clearLadderState(): void;
  syncPlayerPickupSensor(): void;
}

export class OverworldRoomTransitionController {
  constructor(private readonly host: OverworldRoomTransitionHost) {}

  maybeAdvancePlayerRoom(): void {
    if (this.host.getMode() !== 'play') return;

    const player = this.host.getPlayer();
    if (!player) return;

    const currentRoomCoordinates = this.host.getCurrentRoomCoordinates();
    const nextRoomCoordinates = this.host.getRoomCoordinatesForPoint(player.x, player.y);
    if (
      nextRoomCoordinates.x === currentRoomCoordinates.x &&
      nextRoomCoordinates.y === currentRoomCoordinates.y
    ) {
      return;
    }

    if (this.shouldBlockRoomTransition(currentRoomCoordinates, nextRoomCoordinates)) {
      this.blockRoomTransition(currentRoomCoordinates, nextRoomCoordinates);
      return;
    }

    this.host.resetChallengeStateForRoomExit(nextRoomCoordinates);
    this.host.setCurrentRoomCoordinates(nextRoomCoordinates);
    this.host.setSelectedCoordinates(nextRoomCoordinates);
    this.host.updateSelectedSummary();

    if (!this.host.getActiveCourseRun()) {
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
      void this.host.refreshAround(nextRoomCoordinates);
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
  ): boolean {
    const deltaX = nextRoomCoordinates.x - currentRoomCoordinates.x;
    const deltaY = nextRoomCoordinates.y - currentRoomCoordinates.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) {
      return false;
    }

    return !this.isNeighborReachableInCurrentPlayMode(currentRoomCoordinates, nextRoomCoordinates);
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
    player.setPosition(nextX, nextY);
    this.host.syncPlayerPickupSensor();
  }
}
