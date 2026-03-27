import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../../config';
import {
  type CourseSnapshot,
} from '../../courses/model';
import {
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import {
  getOrthogonalNeighbors,
} from '../../persistence/worldModel';
import type {
  OverworldMode,
} from '../sceneData';
import type {
  ActiveCourseRunState,
} from './courseRuns';
import type {
  CameraMode,
} from './camera';
import type {
  SelectedCellState,
} from './hudViewModel';
import type {
  LoadedFullRoom,
} from './worldStreaming';

export interface OverworldRoomEdgeWall {
  rect: Phaser.GameObjects.Rectangle;
  collider: Phaser.Physics.Arcade.Collider;
}

interface OverworldRuntimeControllerHost<TLiveObject> {
  scene: Phaser.Scene;
  getLoadedFullRooms(): Iterable<LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>>;
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  getSelectedCoordinates(): RoomCoordinates;
  getCurrentRoomSnapshot(): RoomSnapshot | null;
  getActiveCourseSnapshot(): CourseSnapshot | null;
  getActiveCourseRun(): ActiveCourseRunState | null;
  getShouldRespawnPlayer(): boolean;
  setShouldRespawnPlayer(value: boolean): void;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  createPlayer(room: RoomSnapshot): void;
  destroyPlayer(): void;
  syncAppMode(): void;
  setCameraMode(mode: CameraMode): void;
  clearCurrentGoalRun(): void;
  syncGoalRunForRoom(room: RoomSnapshot | null, entryContext?: 'transition' | 'spawn'): void;
  redrawGoalMarkers(): void;
  syncCameraBoundsUsage(): void;
  syncGhostVisibility(): void;
  getShouldCenterCamera(): boolean;
  setShouldCenterCamera(value: boolean): void;
  centerCameraOnCoordinates(coordinates: RoomCoordinates): void;
  constrainInspectCamera(): void;
  applyCameraMode(forceCenter?: boolean): void;
  syncLiveObjectInteractions(
    loadedRooms: Iterable<LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>>,
  ): void;
  clearRoomInteractions(loadedRoom: LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>): void;
  destroyRoomEdgeWalls(loadedRoom: LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>): void;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState;
  syncBackdropCameraIgnores(): void;
}

interface OverworldRuntimeControllerOptions {
  edgeWallThickness: number;
}

export class OverworldRuntimeController<TLiveObject = unknown> {
  constructor(
    private readonly host: OverworldRuntimeControllerHost<TLiveObject>,
    private readonly options: OverworldRuntimeControllerOptions,
  ) {}

  syncModeRuntime(): void {
    if (this.host.getMode() === 'browse') {
      this.host.syncAppMode();
      this.host.destroyPlayer();
      this.host.setCameraMode('inspect');
      this.host.clearCurrentGoalRun();
      this.host.redrawGoalMarkers();
      this.host.syncCameraBoundsUsage();
      this.syncEdgeWalls();
      if (this.host.getShouldCenterCamera()) {
        this.host.centerCameraOnCoordinates(this.host.getSelectedCoordinates());
        this.host.setShouldCenterCamera(false);
      } else {
        this.host.constrainInspectCamera();
      }
      this.host.syncGhostVisibility();
      return;
    }

    const currentRoom = this.host.getCurrentRoomSnapshot();
    if (!currentRoom) {
      this.host.setMode('browse');
      this.host.setCameraMode('inspect');
      this.host.syncAppMode();
      this.host.syncCameraBoundsUsage();
      this.host.syncGoalRunForRoom(null);
      this.host.destroyPlayer();
      this.host.syncGhostVisibility();
      return;
    }

    if (!this.host.getPlayer() || this.host.getShouldRespawnPlayer()) {
      this.host.destroyPlayer();
      this.host.createPlayer(currentRoom);
      this.host.setShouldRespawnPlayer(false);
    }

    if (this.host.getActiveCourseRun()) {
      this.host.clearCurrentGoalRun();
      this.host.redrawGoalMarkers();
    } else {
      this.host.syncGoalRunForRoom(currentRoom, 'spawn');
    }

    this.syncFullRoomColliders();
    this.syncLiveObjectInteractions();
    this.syncEdgeWalls();
    this.host.applyCameraMode(this.host.getShouldCenterCamera());
    this.host.setShouldCenterCamera(false);
    this.host.syncGhostVisibility();
  }

  syncFullRoomColliders(): void {
    const player = this.host.getPlayer();
    if (!player) {
      return;
    }

    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      if (!loadedRoom.terrainCollider) {
        loadedRoom.terrainCollider = this.host.scene.physics.add.collider(
          player,
          loadedRoom.terrainLayer,
        );
      }
      if (loadedRoom.terrainInsetBodies && !loadedRoom.terrainInsetCollider) {
        loadedRoom.terrainInsetCollider = this.host.scene.physics.add.collider(
          player,
          loadedRoom.terrainInsetBodies,
        );
      }
    }
  }

  syncLiveObjectInteractions(): void {
    this.host.syncLiveObjectInteractions(this.host.getLoadedFullRooms());
  }

  syncEdgeWalls(): void {
    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      this.host.destroyRoomEdgeWalls(loadedRoom);

      if (!this.host.getPlayerBody() || this.host.getMode() !== 'play') {
        continue;
      }

      for (const neighbor of getOrthogonalNeighbors(loadedRoom.room.coordinates)) {
        if (this.isNeighborReachable(loadedRoom.room.coordinates, neighbor)) {
          continue;
        }

        const edgeWall = this.createEdgeWall(loadedRoom.room.coordinates, neighbor);
        if (edgeWall) {
          loadedRoom.edgeWalls.push(edgeWall);
        }
      }
    }
  }

  isNeighborReachable(
    roomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates,
  ): boolean {
    const activeCourseSnapshot = this.host.getActiveCourseSnapshot();
    if (activeCourseSnapshot) {
      const deltaX = Math.abs(neighborCoordinates.x - roomCoordinates.x);
      const deltaY = Math.abs(neighborCoordinates.y - roomCoordinates.y);
      if (deltaX + deltaY !== 1) {
        return false;
      }

      const currentRoomId = roomIdFromCoordinates(roomCoordinates);
      const neighborRoomId = roomIdFromCoordinates(neighborCoordinates);
      const currentInCourse = activeCourseSnapshot.roomRefs.some(
        (roomRef) => roomRef.roomId === currentRoomId,
      );
      const neighborInCourse = activeCourseSnapshot.roomRefs.some(
        (roomRef) => roomRef.roomId === neighborRoomId,
      );
      return currentInCourse && neighborInCourse;
    }

    const neighborState = this.host.getCellStateAt(neighborCoordinates);
    return neighborState === 'published' || neighborState === 'draft';
  }

  private createEdgeWall(
    roomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates,
  ): OverworldRoomEdgeWall | null {
    const player = this.host.getPlayer();
    if (!player) {
      return null;
    }

    const roomOrigin = this.host.getRoomOrigin(roomCoordinates);
    const deltaX = neighborCoordinates.x - roomCoordinates.x;
    const deltaY = neighborCoordinates.y - roomCoordinates.y;
    const thickness = this.options.edgeWallThickness;

    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;

    if (deltaX === 1) {
      x = roomOrigin.x + ROOM_PX_WIDTH - thickness / 2;
      y = roomOrigin.y + ROOM_PX_HEIGHT / 2;
      width = thickness;
      height = ROOM_PX_HEIGHT;
    } else if (deltaX === -1) {
      x = roomOrigin.x + thickness / 2;
      y = roomOrigin.y + ROOM_PX_HEIGHT / 2;
      width = thickness;
      height = ROOM_PX_HEIGHT;
    } else if (deltaY === 1) {
      x = roomOrigin.x + ROOM_PX_WIDTH / 2;
      y = roomOrigin.y + ROOM_PX_HEIGHT - thickness / 2;
      width = ROOM_PX_WIDTH;
      height = thickness;
    } else if (deltaY === -1) {
      x = roomOrigin.x + ROOM_PX_WIDTH / 2;
      y = roomOrigin.y + thickness / 2;
      width = ROOM_PX_WIDTH;
      height = thickness;
    } else {
      return null;
    }

    const rect = this.host.scene.add.rectangle(x, y, width, height, 0xffffff, 0);
    rect.setDepth(15);
    this.host.scene.physics.add.existing(rect, true);
    const collider = this.host.scene.physics.add.collider(player, rect);
    this.host.syncBackdropCameraIgnores();
    return { rect, collider };
  }
}
