import Phaser from 'phaser';
import { setActiveCourseDraftSessionSelectedRoom } from '../../courses/draftSession';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { setFocusedCoordinatesInUrl } from '../../navigation/worldNavigation';
import { roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import { playSfx } from '../../audio/sfx';
import type { OverworldMode } from '../sceneData';
import type { CameraMode } from './camera';
import type { SelectedCellState } from './hudViewModel';

type PointerPosition = {
  x: number;
  y: number;
};

interface OverworldSelectionHost {
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  setCameraMode(mode: CameraMode): void;
  getFitZoomForRoom(): number;
  setInspectZoom(zoom: number): void;
  setBrowseInspectZoom(zoom: number): void;
  syncAppMode(): void;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  setWindowCenterCoordinates(coordinates: RoomCoordinates): void;
  setShouldCenterCamera(value: boolean): void;
  setShouldRespawnPlayer(value: boolean): void;
  updateSelectedSummary(): void;
  refreshCourseComposerSelectedRoomState(): Promise<void>;
  refreshLeaderboardForSelection(): Promise<void>;
  redrawWorld(): void;
  renderHud(): void;
  refreshAround(
    coordinates: RoomCoordinates,
    options?: { forceChunkReload?: boolean }
  ): Promise<boolean>;
  getRoomSummary(roomId: string): WorldRoomSummary | undefined;
  hasDraftRoom(roomId: string): boolean;
  hasActiveCourseRoomOverride(roomId: string): boolean;
  isRoomInActiveCourse(coordinates: RoomCoordinates): boolean;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean;
  getMainCamera(): Phaser.Cameras.Scene2D.Camera;
  getWindowCenterCoordinates(): RoomCoordinates;
  refreshChunkWindowIfNeeded(centerCoordinates: RoomCoordinates): void;
}

export class OverworldSelectionController {
  constructor(private readonly host: OverworldSelectionHost) {}

  selectRoomCoordinates(coordinates: RoomCoordinates): void {
    const nextCoordinates = { ...coordinates };
    this.host.setSelectedCoordinates(nextCoordinates);
    if (this.host.getMode() !== 'play') {
      this.host.setCurrentRoomCoordinates(nextCoordinates);
    }

    setActiveCourseDraftSessionSelectedRoom(roomIdFromCoordinates(nextCoordinates));
    this.host.updateSelectedSummary();
    void this.host.refreshCourseComposerSelectedRoomState();
    void this.host.refreshLeaderboardForSelection();
    this.host.redrawWorld();
    this.host.renderHud();
  }

  async jumpToCoordinates(coordinates: RoomCoordinates): Promise<void> {
    const nextCoordinates = { ...coordinates };
    this.host.setMode('browse');
    this.host.setCameraMode('inspect');
    const fitZoom = this.host.getFitZoomForRoom();
    this.host.setInspectZoom(fitZoom);
    this.host.setBrowseInspectZoom(fitZoom);
    this.host.syncAppMode();
    this.host.setSelectedCoordinates(nextCoordinates);
    this.host.setCurrentRoomCoordinates(nextCoordinates);
    this.host.setWindowCenterCoordinates(nextCoordinates);
    this.host.setShouldCenterCamera(true);
    this.host.setShouldRespawnPlayer(false);
    setFocusedCoordinatesInUrl(nextCoordinates);
    playSfx('warp');
    await this.host.refreshAround(nextCoordinates);
  }

  syncBrowseWindowToCamera(
    panStartPointer: PointerPosition,
    panCurrentPointer: PointerPosition,
  ): void {
    if (this.host.getMode() !== 'browse') {
      return;
    }

    const camera = this.host.getMainCamera();
    const centerWorldPoint = camera.getWorldPoint(camera.width * 0.5, camera.height * 0.5);
    const nextCenterCoordinates = this.getRoomCoordinatesForPoint(centerWorldPoint.x, centerWorldPoint.y);
    const currentCenterCoordinates = this.host.getWindowCenterCoordinates();
    const dragDeltaX = panStartPointer.x - panCurrentPointer.x;
    const dragDeltaY = panStartPointer.y - panCurrentPointer.y;

    if (Math.abs(dragDeltaX) > Math.abs(dragDeltaY) * 1.5) {
      nextCenterCoordinates.y = currentCenterCoordinates.y;
    } else if (Math.abs(dragDeltaY) > Math.abs(dragDeltaX) * 1.5) {
      nextCenterCoordinates.x = currentCenterCoordinates.x;
    }

    if (
      nextCenterCoordinates.x === currentCenterCoordinates.x &&
      nextCenterCoordinates.y === currentCenterCoordinates.y
    ) {
      this.host.refreshChunkWindowIfNeeded(nextCenterCoordinates);
      return;
    }

    void this.host.refreshAround(nextCenterCoordinates);
  }

  getRoomCoordinatesForPoint(x: number, y: number): RoomCoordinates {
    return {
      x: Math.floor(x / ROOM_PX_WIDTH),
      y: Math.floor(y / ROOM_PX_HEIGHT),
    };
  }

  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean {
    return this.host.isWithinLoadedRoomBounds(coordinates);
  }

  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number } {
    return {
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    };
  }

  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    return this.host.getRoomSnapshotForCoordinates(coordinates);
  }

  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState {
    const roomId = roomIdFromCoordinates(coordinates);
    if (this.host.hasActiveCourseRoomOverride(roomId)) {
      return 'published';
    }
    if (this.host.hasDraftRoom(roomId)) {
      return 'draft';
    }

    const summary = this.host.getRoomSummary(roomId);
    if (summary?.state === 'published') {
      return 'published';
    }
    if (summary?.state === 'frontier') {
      return 'frontier';
    }
    return 'empty';
  }

  isRoomInActiveCourse(coordinates: RoomCoordinates): boolean {
    return this.host.isRoomInActiveCourse(coordinates);
  }
}
