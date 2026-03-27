import Phaser from 'phaser';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { OverworldMode } from '../sceneData';
import type { CameraMode } from './camera';

const PAN_THRESHOLD = 4;

type PointerPosition = {
  x: number;
  y: number;
};

interface OverworldInspectInputHost {
  getMode(): OverworldMode;
  getCameraMode(): CameraMode;
  setCameraMode(mode: CameraMode): void;
  applyCameraMode(): void;
  fitLoadedWorld(): void;
  returnToWorld(): void;
  adjustZoomByFactor(factor: number, screenX?: number, screenY?: number): void;
  constrainInspectCamera(): void;
  getRoomCoordinatesForPoint(x: number, y: number): RoomCoordinates;
  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean;
  onSelectCoordinates(coordinates: RoomCoordinates): void;
  syncBrowseWindowToCamera(
    panStartPointer: PointerPosition,
    panCurrentPointer: PointerPosition,
  ): void;
}

export class OverworldInspectInputController {
  private isPanning = false;
  private panStartPointer: PointerPosition = { x: 0, y: 0 };
  private panCurrentPointer: PointerPosition = { x: 0, y: 0 };
  private panStartScroll: PointerPosition = { x: 0, y: 0 };
  private readonly touchPointers = new Map<number, PointerPosition>();
  private activePrimaryTouchId: number | null = null;
  private touchTapCandidate:
    | {
        pointerId: number;
        startX: number;
        startY: number;
      }
    | null = null;
  private touchPinchDistance = 0;
  private touchPinchAnchor: PointerPosition = { x: 0, y: 0 };
  private altDown = false;
  private spaceDown = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldInspectInputHost,
  ) {}

  initialize(): void {
    const keyboard = this.scene.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-F', this.handleFitWorldKeydown);
      keyboard.on('keydown-P', this.handleReturnToWorldKeydown);
      keyboard.on('keydown-ESC', this.handleReturnToWorldKeydown);
      keyboard.on('keydown-ALT', this.handleAltKeydown);
      keyboard.on('keyup-ALT', this.handleAltKeyup);
      keyboard.on('keydown-SPACE', this.handleSpaceKeydown);
      keyboard.on('keyup-SPACE', this.handleSpaceKeyup);
    }

    this.scene.input.on('pointerdown', this.handlePointerDown);
    this.scene.input.on('pointermove', this.handlePointerMove);
    this.scene.input.on('pointerup', this.handlePointerUp);
  }

  destroy(): void {
    const keyboard = this.scene.input.keyboard;
    if (keyboard) {
      keyboard.off('keydown-F', this.handleFitWorldKeydown);
      keyboard.off('keydown-P', this.handleReturnToWorldKeydown);
      keyboard.off('keydown-ESC', this.handleReturnToWorldKeydown);
      keyboard.off('keydown-ALT', this.handleAltKeydown);
      keyboard.off('keyup-ALT', this.handleAltKeyup);
      keyboard.off('keydown-SPACE', this.handleSpaceKeydown);
      keyboard.off('keyup-SPACE', this.handleSpaceKeyup);
    }

    this.scene.input.off('pointerdown', this.handlePointerDown);
    this.scene.input.off('pointermove', this.handlePointerMove);
    this.scene.input.off('pointerup', this.handlePointerUp);
    this.reset();
  }

  reset(): void {
    const camera = this.scene.cameras.main;
    this.isPanning = false;
    this.panStartPointer = { x: 0, y: 0 };
    this.panCurrentPointer = { x: 0, y: 0 };
    this.panStartScroll = {
      x: camera?.scrollX ?? 0,
      y: camera?.scrollY ?? 0,
    };
    this.touchPointers.clear();
    this.activePrimaryTouchId = null;
    this.touchTapCandidate = null;
    this.touchPinchDistance = 0;
    this.touchPinchAnchor = { x: 0, y: 0 };
    this.altDown = false;
    this.spaceDown = false;
  }

  private readonly handleFitWorldKeydown = (): void => {
    this.host.fitLoadedWorld();
  };

  private readonly handleReturnToWorldKeydown = (): void => {
    if (this.host.getMode() === 'play') {
      this.host.returnToWorld();
    }
  };

  private readonly handleAltKeydown = (): void => {
    this.altDown = true;
  };

  private readonly handleAltKeyup = (): void => {
    this.altDown = false;
    this.isPanning = false;
  };

  private readonly handleSpaceKeydown = (): void => {
    this.spaceDown = true;
  };

  private readonly handleSpaceKeyup = (): void => {
    this.spaceDown = false;
    this.isPanning = false;
  };

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.handleTouchPointerDown(pointer)) {
      return;
    }

    if (this.pointerRequestsPan(pointer)) {
      if (this.host.getCameraMode() === 'follow') {
        this.host.setCameraMode('inspect');
        this.host.applyCameraMode();
      }

      this.isPanning = true;
      this.panStartPointer = { x: pointer.x, y: pointer.y };
      this.panCurrentPointer = { x: pointer.x, y: pointer.y };
      this.panStartScroll = {
        x: this.scene.cameras.main.scrollX,
        y: this.scene.cameras.main.scrollY,
      };
      return;
    }

    this.selectRoomForPointer(pointer);
  };

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.handleTouchPointerMove(pointer)) {
      return;
    }

    if (!this.isPanning) {
      return;
    }

    const distance = Phaser.Math.Distance.Between(
      this.panStartPointer.x,
      this.panStartPointer.y,
      pointer.x,
      pointer.y,
    );
    if (distance < PAN_THRESHOLD) {
      return;
    }

    this.panCurrentPointer = { x: pointer.x, y: pointer.y };

    const camera = this.scene.cameras.main;
    const dx = (this.panStartPointer.x - pointer.x) / camera.zoom;
    const dy = (this.panStartPointer.y - pointer.y) / camera.zoom;
    camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
    this.host.constrainInspectCamera();
  };

  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (this.handleTouchPointerUp(pointer)) {
      return;
    }

    const wasPanning = this.isPanning;
    this.isPanning = false;

    if (wasPanning && this.host.getMode() === 'browse') {
      this.host.syncBrowseWindowToCamera(this.panStartPointer, this.panCurrentPointer);
    }
  };

  private selectRoomForPointer(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const coordinates = this.host.getRoomCoordinatesForPoint(worldPoint.x, worldPoint.y);
    if (!this.host.isWithinLoadedRoomBounds(coordinates)) {
      return;
    }

    this.host.onSelectCoordinates(coordinates);
  }

  private handleTouchPointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    this.touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });

    if (this.touchPointers.size >= 2) {
      this.touchTapCandidate = null;
      this.activePrimaryTouchId = null;
      this.beginTouchPinchGesture();
      return true;
    }

    this.activePrimaryTouchId = pointer.id;
    this.touchTapCandidate = {
      pointerId: pointer.id,
      startX: pointer.x,
      startY: pointer.y,
    };
    this.panStartPointer = { x: pointer.x, y: pointer.y };
    this.panCurrentPointer = { x: pointer.x, y: pointer.y };
    this.panStartScroll = {
      x: this.scene.cameras.main.scrollX,
      y: this.scene.cameras.main.scrollY,
    };
    return true;
  }

  private handleTouchPointerMove(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    if (!this.touchPointers.has(pointer.id)) {
      return true;
    }

    this.touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });

    if (this.touchPointers.size >= 2) {
      this.handleTouchPinchMove();
      return true;
    }

    if (this.activePrimaryTouchId !== pointer.id) {
      return true;
    }

    this.panCurrentPointer = { x: pointer.x, y: pointer.y };
    const distance = Phaser.Math.Distance.Between(
      this.panStartPointer.x,
      this.panStartPointer.y,
      pointer.x,
      pointer.y,
    );

    if (distance < PAN_THRESHOLD) {
      return true;
    }

    if (this.host.getMode() === 'browse' || this.host.getCameraMode() === 'inspect') {
      const camera = this.scene.cameras.main;
      const dx = (this.panStartPointer.x - pointer.x) / camera.zoom;
      const dy = (this.panStartPointer.y - pointer.y) / camera.zoom;
      camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
      this.host.constrainInspectCamera();
      this.touchTapCandidate = null;
    }

    return true;
  }

  private handleTouchPointerUp(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    const wasPinching = this.touchPointers.size >= 2;
    this.touchPointers.delete(pointer.id);

    if (wasPinching) {
      if (this.touchPointers.size === 1) {
        const [remainingId, remainingPoint] = Array.from(this.touchPointers.entries())[0];
        this.activePrimaryTouchId = remainingId;
        this.touchTapCandidate = {
          pointerId: remainingId,
          startX: remainingPoint.x,
          startY: remainingPoint.y,
        };
        this.panStartPointer = { ...remainingPoint };
        this.panCurrentPointer = { ...remainingPoint };
        this.panStartScroll = {
          x: this.scene.cameras.main.scrollX,
          y: this.scene.cameras.main.scrollY,
        };
      } else {
        this.activePrimaryTouchId = null;
        this.touchTapCandidate = null;
      }
      return true;
    }

    if (this.touchTapCandidate?.pointerId === pointer.id) {
      const movedDistance = Phaser.Math.Distance.Between(
        this.touchTapCandidate.startX,
        this.touchTapCandidate.startY,
        pointer.x,
        pointer.y,
      );
      if (movedDistance < PAN_THRESHOLD && this.host.getMode() === 'browse') {
        this.selectRoomForPointer(pointer);
      } else if (this.host.getMode() === 'browse') {
        this.host.syncBrowseWindowToCamera(this.panStartPointer, this.panCurrentPointer);
      }
    } else if (this.host.getMode() === 'browse') {
      this.host.syncBrowseWindowToCamera(this.panStartPointer, this.panCurrentPointer);
    }

    this.touchTapCandidate = null;
    this.activePrimaryTouchId = null;
    return true;
  }

  private beginTouchPinchGesture(): void {
    const points = Array.from(this.touchPointers.values());
    if (points.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    this.touchPinchDistance = Phaser.Math.Distance.Between(
      firstPoint.x,
      firstPoint.y,
      secondPoint.x,
      secondPoint.y,
    );
    this.touchPinchAnchor = {
      x: (firstPoint.x + secondPoint.x) * 0.5,
      y: (firstPoint.y + secondPoint.y) * 0.5,
    };
    this.panStartScroll = {
      x: this.scene.cameras.main.scrollX,
      y: this.scene.cameras.main.scrollY,
    };
  }

  private handleTouchPinchMove(): void {
    const points = Array.from(this.touchPointers.values());
    if (points.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    const nextDistance = Phaser.Math.Distance.Between(
      firstPoint.x,
      firstPoint.y,
      secondPoint.x,
      secondPoint.y,
    );
    if (this.touchPinchDistance <= 0) {
      this.touchPinchDistance = nextDistance;
      return;
    }

    const anchorX = (firstPoint.x + secondPoint.x) * 0.5;
    const anchorY = (firstPoint.y + secondPoint.y) * 0.5;
    const zoomFactor = nextDistance / this.touchPinchDistance;
    if (Math.abs(zoomFactor - 1) > 0.02) {
      this.host.adjustZoomByFactor(zoomFactor, anchorX, anchorY);
      this.touchPinchDistance = nextDistance;
    }

    if (this.host.getMode() === 'browse' || this.host.getCameraMode() === 'inspect') {
      const camera = this.scene.cameras.main;
      const dx = (this.touchPinchAnchor.x - anchorX) / camera.zoom;
      const dy = (this.touchPinchAnchor.y - anchorY) / camera.zoom;
      camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
      this.host.constrainInspectCamera();
    }
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    const layout = getDeviceLayoutState();
    if (!layout.coarsePointer) {
      return false;
    }

    const event = pointer.event as PointerEvent | MouseEvent | undefined;
    if (!event) {
      return layout.coarsePointer;
    }

    if ('pointerType' in event && typeof event.pointerType === 'string') {
      return event.pointerType === 'touch' || event.pointerType === 'pen';
    }

    return layout.coarsePointer;
  }

  private pointerRequestsPan(pointer: Phaser.Input.Pointer): boolean {
    const altPressed = this.altDown || Boolean((pointer.event as MouseEvent | undefined)?.altKey);
    return pointer.middleButtonDown() || this.spaceDown || altPressed;
  }
}
