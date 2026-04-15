import { getDeviceLayoutState } from '../deviceLayout';
import {
  pressTouchAction,
  resetTouchInputState,
  setTouchActionHeld,
  setTouchControlsActive,
  setTouchMove,
} from './touchControls';

const MOBILE_MOVE_HORIZONTAL_DEADZONE_PX = 3;
const MOBILE_MOVE_HORIZONTAL_FULL_TILT_PX = 15;
const MOBILE_MOVE_VERTICAL_DEADZONE_PX = 10;
const MOBILE_MOVE_VERTICAL_FULL_TILT_PX = 38;
const MOBILE_MOVE_STICK_VISUAL_LIMIT_PX = 42;
const MOBILE_MOVE_TOUCH_MATCH_RADIUS_PX = 96;

type TouchHoldAction = 'jump' | 'slash' | 'shoot';

type Elements = {
  mobilePlayControls: HTMLElement | null;
  mobileMoveZone: HTMLElement | null;
  mobileMoveStick: HTMLElement | null;
  mobileJumpButton: HTMLButtonElement | null;
  mobileSlashButton: HTMLButtonElement | null;
  mobileShootButton: HTMLButtonElement | null;
  mobileWorldStopButton: HTMLButtonElement | null;
  mobileWorldRestartButton: HTMLButtonElement | null;
};

export class PortraitPlayControlsController {
  private readonly elements: Elements;
  private activeMovePointerId: number | null = null;
  private movePointerOrigin: { x: number; y: number } | null = null;
  private movePointerLastPosition: { x: number; y: number } | null = null;
  private readonly activeActionPointerIds = new Map<TouchHoldAction, number>();
  private globalReleaseHandlersBound = false;

  constructor(
    private readonly doc: Document = document,
  ) {
    this.elements = {
      mobilePlayControls: doc.getElementById('mobile-play-controls'),
      mobileMoveZone: doc.getElementById('mobile-move-zone'),
      mobileMoveStick: doc.getElementById('mobile-move-stick'),
      mobileJumpButton: doc.getElementById('btn-mobile-jump') as HTMLButtonElement | null,
      mobileSlashButton: doc.getElementById('btn-mobile-slash') as HTMLButtonElement | null,
      mobileShootButton: doc.getElementById('btn-mobile-shoot') as HTMLButtonElement | null,
      mobileWorldStopButton: doc.getElementById('btn-mobile-world-stop') as HTMLButtonElement | null,
      mobileWorldRestartButton: doc.getElementById('btn-mobile-world-restart') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.bindMoveZone();
    this.bindActionButtons();
    this.bindGlobalReleaseHandlers();
  }

  destroy(): void {
    this.render(false);
    this.unbindGlobalReleaseHandlers();
  }

  render(isPortraitPlay: boolean): void {
    this.elements.mobilePlayControls?.classList.toggle('hidden', !isPortraitPlay);
    setTouchControlsActive(isPortraitPlay);

    if (!isPortraitPlay) {
      this.releaseAllControlState();
    }
  }

  private bindMoveZone(): void {
    const moveZone = this.elements.mobileMoveZone;
    if (!moveZone) {
      return;
    }

    moveZone.addEventListener('pointerdown', (event) => {
      if (!this.isPortraitMoveZoneActive() || this.activeMovePointerId !== null) {
        return;
      }

      event.preventDefault();
      if (!this.isPointInsideMoveStick(event)) {
        return;
      }

      this.activeMovePointerId = event.pointerId;
      this.movePointerOrigin = { x: event.clientX, y: event.clientY };
      this.movePointerLastPosition = { x: event.clientX, y: event.clientY };
      moveZone.setAttribute('data-mobile-move-active', 'true');
      setTouchMove(0, 0);
      this.trySetPointerCapture(moveZone, event.pointerId);
    });

    moveZone.addEventListener('pointermove', (event) => {
      if (
        event.pointerId !== this.activeMovePointerId
        || !this.movePointerOrigin
      ) {
        return;
      }

      event.preventDefault();
      if (!this.isPortraitMoveZoneActive()) {
        this.clearMoveZoneState();
        return;
      }

      const deltaX = event.clientX - this.movePointerOrigin.x;
      const deltaY = event.clientY - this.movePointerOrigin.y;
      this.movePointerLastPosition = { x: event.clientX, y: event.clientY };
      this.syncMoveStickVisual(deltaX, deltaY);
      setTouchMove(
        this.resolveTightMoveAxis(
          deltaX,
          MOBILE_MOVE_HORIZONTAL_DEADZONE_PX,
          MOBILE_MOVE_HORIZONTAL_FULL_TILT_PX,
        ),
        this.resolveTightMoveAxis(
          deltaY,
          MOBILE_MOVE_VERTICAL_DEADZONE_PX,
          MOBILE_MOVE_VERTICAL_FULL_TILT_PX,
        ),
      );
    });

    moveZone.addEventListener('pointerup', this.releaseMoveZonePointer);
    moveZone.addEventListener('pointercancel', this.releaseMoveZonePointer);
    moveZone.addEventListener('lostpointercapture', this.releaseMoveZonePointer);
  }

  private bindActionButtons(): void {
    this.bindHoldButton(this.elements.mobileJumpButton, 'jump');
    this.bindHoldButton(this.elements.mobileSlashButton, 'slash');
    this.bindHoldButton(this.elements.mobileShootButton, 'shoot');

    this.elements.mobileWorldStopButton?.addEventListener('click', () => {
      if (this.doc.body.dataset.appMode === 'play-world') {
        pressTouchAction('stop');
      }
    });
    this.elements.mobileWorldRestartButton?.addEventListener('click', () => {
      if (this.doc.body.dataset.appMode === 'play-world') {
        pressTouchAction('restart');
      }
    });
  }

  private bindHoldButton(button: HTMLButtonElement | null, action: TouchHoldAction): void {
    if (!button) {
      return;
    }

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.activeActionPointerIds.set(action, event.pointerId);
      setTouchActionHeld(action, true);
      pressTouchAction(action);
      this.trySetPointerCapture(button, event.pointerId);
    });
    button.addEventListener('pointerup', (event) => {
      this.releaseHeldActionPointer(action, event.pointerId);
    });
    button.addEventListener('pointercancel', (event) => {
      this.releaseHeldActionPointer(action, event.pointerId);
    });
    button.addEventListener('lostpointercapture', (event) => {
      this.releaseHeldActionPointer(action, event.pointerId);
    });
  }

  private bindGlobalReleaseHandlers(): void {
    if (this.globalReleaseHandlersBound) {
      return;
    }

    this.globalReleaseHandlersBound = true;
    this.doc.addEventListener('pointerup', this.releaseMoveZonePointer, true);
    this.doc.addEventListener('pointercancel', this.releaseMoveZonePointer, true);
    this.doc.addEventListener('pointerup', this.releaseHeldActionPointerFromEvent, true);
    this.doc.addEventListener('pointercancel', this.releaseHeldActionPointerFromEvent, true);
    this.doc.addEventListener('touchend', this.releaseMoveZoneFromTouchEvent, true);
    this.doc.addEventListener('touchcancel', this.releaseMoveZoneFromTouchEvent, true);
    this.doc.addEventListener('visibilitychange', this.releaseControlsWhenHidden);
    this.doc.defaultView?.addEventListener('blur', this.releaseAllControlState);
    this.doc.defaultView?.addEventListener('pagehide', this.releaseAllControlState);
  }

  private unbindGlobalReleaseHandlers(): void {
    if (!this.globalReleaseHandlersBound) {
      return;
    }

    this.globalReleaseHandlersBound = false;
    this.doc.removeEventListener('pointerup', this.releaseMoveZonePointer, true);
    this.doc.removeEventListener('pointercancel', this.releaseMoveZonePointer, true);
    this.doc.removeEventListener('pointerup', this.releaseHeldActionPointerFromEvent, true);
    this.doc.removeEventListener('pointercancel', this.releaseHeldActionPointerFromEvent, true);
    this.doc.removeEventListener('touchend', this.releaseMoveZoneFromTouchEvent, true);
    this.doc.removeEventListener('touchcancel', this.releaseMoveZoneFromTouchEvent, true);
    this.doc.removeEventListener('visibilitychange', this.releaseControlsWhenHidden);
    this.doc.defaultView?.removeEventListener('blur', this.releaseAllControlState);
    this.doc.defaultView?.removeEventListener('pagehide', this.releaseAllControlState);
  }

  private readonly releaseMoveZonePointer = (event: PointerEvent): void => {
    if (event.pointerId !== this.activeMovePointerId) {
      return;
    }

    event.preventDefault();
    this.clearMoveZoneState();
  };

  private readonly releaseMoveZoneFromTouchEvent = (event: TouchEvent): void => {
    if (this.activeMovePointerId === null) {
      return;
    }

    if (event.touches.length > 0 && this.hasRemainingMoveTouch(event.touches)) {
      return;
    }

    this.clearMoveZoneState();
  };

  private readonly releaseHeldActionPointerFromEvent = (event: PointerEvent): void => {
    for (const [action, pointerId] of this.activeActionPointerIds) {
      if (pointerId === event.pointerId) {
        event.preventDefault();
        this.releaseHeldActionPointer(action, pointerId);
      }
    }
  };

  private readonly releaseControlsWhenHidden = (): void => {
    if (this.doc.visibilityState === 'hidden') {
      this.releaseAllControlState();
    }
  };

  private readonly releaseAllControlState = (): void => {
    this.clearMoveZoneState();
    this.releaseAllHeldActions();
    resetTouchInputState();
  };

  private resolveTightMoveAxis(deltaPx: number, deadzonePx: number, fullTiltPx: number): number {
    const absoluteDelta = Math.abs(deltaPx);
    if (absoluteDelta <= deadzonePx) {
      return 0;
    }

    const denominator = Math.max(1, fullTiltPx - deadzonePx);
    const normalized = Math.min(1, (absoluteDelta - deadzonePx) / denominator);
    return Math.sign(deltaPx) * normalized;
  }

  private isPortraitMoveZoneActive(): boolean {
    const layout = getDeviceLayoutState();
    return (
      layout.deviceClass === 'phone'
      && layout.coarsePointer
      && layout.orientationState === 'portrait'
      && this.doc.body.dataset.appMode === 'play-world'
      && this.doc.body.dataset.mobilePortraitPlay === 'true'
    );
  }

  private isPointInsideMoveStick(event: PointerEvent): boolean {
    const stick = this.elements.mobileMoveStick;
    if (!stick) {
      return false;
    }

    const rect = stick.getBoundingClientRect();
    return (
      event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
    );
  }

  private syncMoveStickVisual(deltaX: number, deltaY: number): void {
    const moveZone = this.elements.mobileMoveZone;
    if (!moveZone) {
      return;
    }

    const visualX = Math.max(
      -MOBILE_MOVE_STICK_VISUAL_LIMIT_PX,
      Math.min(MOBILE_MOVE_STICK_VISUAL_LIMIT_PX, deltaX),
    );
    const visualY = Math.max(
      -MOBILE_MOVE_STICK_VISUAL_LIMIT_PX,
      Math.min(MOBILE_MOVE_STICK_VISUAL_LIMIT_PX, deltaY),
    );
    moveZone.style.setProperty('--mobile-move-stick-x', `${Math.round(visualX)}px`);
    moveZone.style.setProperty('--mobile-move-stick-y', `${Math.round(visualY)}px`);
  }

  private resetMoveStickVisual(): void {
    const moveZone = this.elements.mobileMoveZone;
    if (!moveZone) {
      return;
    }

    moveZone.style.setProperty('--mobile-move-stick-x', '0px');
    moveZone.style.setProperty('--mobile-move-stick-y', '0px');
  }

  private clearMoveZoneState(): void {
    this.activeMovePointerId = null;
    this.movePointerOrigin = null;
    this.movePointerLastPosition = null;
    this.elements.mobileMoveZone?.removeAttribute('data-mobile-move-active');
    this.resetMoveStickVisual();
    setTouchMove(0, 0);
  }

  private releaseHeldActionPointer(action: TouchHoldAction, pointerId: number): void {
    if (this.activeActionPointerIds.get(action) !== pointerId) {
      return;
    }

    this.activeActionPointerIds.delete(action);
    setTouchActionHeld(action, false);
  }

  private releaseAllHeldActions(): void {
    this.activeActionPointerIds.clear();
    setTouchActionHeld('jump', false);
    setTouchActionHeld('slash', false);
    setTouchActionHeld('shoot', false);
  }

  private hasRemainingMoveTouch(touches: TouchList): boolean {
    for (const touch of Array.from(touches)) {
      if (this.isTouchInsideMoveZone(touch) || this.isTouchNearLastMovePosition(touch)) {
        return true;
      }
    }

    return false;
  }

  private isTouchInsideMoveZone(touch: Touch): boolean {
    const moveZone = this.elements.mobileMoveZone;
    if (!moveZone) {
      return false;
    }

    const rect = moveZone.getBoundingClientRect();
    return (
      touch.clientX >= rect.left
      && touch.clientX <= rect.right
      && touch.clientY >= rect.top
      && touch.clientY <= rect.bottom
    );
  }

  private isTouchNearLastMovePosition(touch: Touch): boolean {
    if (!this.movePointerLastPosition) {
      return false;
    }

    const deltaX = touch.clientX - this.movePointerLastPosition.x;
    const deltaY = touch.clientY - this.movePointerLastPosition.y;
    return Math.hypot(deltaX, deltaY) <= MOBILE_MOVE_TOUCH_MATCH_RADIUS_PX;
  }

  private trySetPointerCapture(element: HTMLElement, pointerId: number): void {
    if (typeof element.setPointerCapture !== 'function') {
      return;
    }

    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointer flows and some browser edge cases can reject capture.
    }
  }
}
