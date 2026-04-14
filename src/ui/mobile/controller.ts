import Phaser from 'phaser';
import { getDeviceLayoutState, initializeDeviceLayout, DEVICE_LAYOUT_CHANGED_EVENT } from '../deviceLayout';
import { getActiveOverworldScene, withActiveEditorScene } from '../setup/sceneBridge';
import {
  pressTouchAction,
  resetTouchInputState,
  setTouchActionHeld,
  setTouchControlsActive,
  setTouchMove,
} from './touchControls';
import { hasFocusedRoomCoordinateLink } from './focusedRoomLink';

type EditorSheetId = 'tools' | 'background' | 'palette' | 'objects' | 'goal' | 'actions';
type MoveDirection = 'up' | 'left' | 'right' | 'down';

const MOBILE_MOVE_HORIZONTAL_DEADZONE_PX = 3;
const MOBILE_MOVE_HORIZONTAL_FULL_TILT_PX = 15;
const MOBILE_MOVE_VERTICAL_DEADZONE_PX = 10;
const MOBILE_MOVE_VERTICAL_FULL_TILT_PX = 38;
const MOBILE_MOVE_STICK_VISUAL_LIMIT_PX = 42;

type Elements = {
  rotateGate: HTMLElement | null;
  mobileEditorNav: HTMLElement | null;
  mobileEditorUndoButton: HTMLButtonElement | null;
  mobileEditorToggleButton: HTMLButtonElement | null;
  mobilePlayControls: HTMLElement | null;
  mobileDpad: HTMLElement | null;
  mobileMoveStick: HTMLElement | null;
  mobileDpadButtons: HTMLButtonElement[];
  mobileJumpButton: HTMLButtonElement | null;
  mobileSlashButton: HTMLButtonElement | null;
  mobileShootButton: HTMLButtonElement | null;
  mobileWorldStopButton: HTMLButtonElement | null;
  mobileWorldRestartButton: HTMLButtonElement | null;
  mobileCameraTuner: HTMLElement | null;
  mobileCameraTunerValue: HTMLElement | null;
  mobileCameraTunerButtons: HTMLButtonElement[];
  worldHudToggleButton: HTMLButtonElement | null;
  worldHudMinimizeButton: HTMLButtonElement | null;
  worldChatButton: HTMLButtonElement | null;
  worldRoomChatButton: HTMLButtonElement | null;
  worldJumpSheetButton: HTMLButtonElement | null;
  worldJumpSheet: HTMLElement | null;
  worldJumpSheetInput: HTMLInputElement | null;
  worldJumpSheetGoButton: HTMLButtonElement | null;
  worldJumpSheetCloseButton: HTMLButtonElement | null;
  worldJumpInput: HTMLInputElement | null;
  worldJumpButton: HTMLButtonElement | null;
  chatToggleButton: HTMLButtonElement | null;
};

export class MobileUiController {
  private readonly elements: Elements;
  private readonly mutationObserver: MutationObserver;
  private pausedSceneKeys = new Set<string>();
  private activeEditorSheet: EditorSheetId = 'tools';
  private editorSheetCollapsed = false;
  private worldHudCollapsed = false;
  private previousAppMode: string | null = null;
  private activeDpadPointers = new Map<number, MoveDirection>();
  private activeMovePointerId: number | null = null;
  private movePointerOrigin: { x: number; y: number } | null = null;
  private lastTouchEndAt = 0;

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      rotateGate: doc.getElementById('rotate-gate'),
      mobileEditorNav: doc.getElementById('mobile-editor-nav'),
      mobileEditorUndoButton: doc.getElementById('btn-mobile-editor-undo') as HTMLButtonElement | null,
      mobileEditorToggleButton: doc.getElementById('btn-mobile-editor-toggle') as HTMLButtonElement | null,
      mobilePlayControls: doc.getElementById('mobile-play-controls'),
      mobileDpad: doc.getElementById('mobile-dpad'),
      mobileMoveStick: doc.getElementById('mobile-move-stick'),
      mobileDpadButtons: Array.from(doc.querySelectorAll<HTMLButtonElement>('[data-mobile-direction]')),
      mobileJumpButton: doc.getElementById('btn-mobile-jump') as HTMLButtonElement | null,
      mobileSlashButton: doc.getElementById('btn-mobile-slash') as HTMLButtonElement | null,
      mobileShootButton: doc.getElementById('btn-mobile-shoot') as HTMLButtonElement | null,
      mobileWorldStopButton: doc.getElementById('btn-mobile-world-stop') as HTMLButtonElement | null,
      mobileWorldRestartButton: doc.getElementById('btn-mobile-world-restart') as HTMLButtonElement | null,
      mobileCameraTuner: doc.getElementById('mobile-camera-tuner'),
      mobileCameraTunerValue: doc.getElementById('mobile-camera-tuner-value'),
      mobileCameraTunerButtons: Array.from(doc.querySelectorAll<HTMLButtonElement>('[data-mobile-camera-tuner-action]')),
      worldHudToggleButton: doc.getElementById('btn-world-hud-toggle') as HTMLButtonElement | null,
      worldHudMinimizeButton: doc.getElementById('btn-mobile-world-hud-minimize') as HTMLButtonElement | null,
      worldChatButton: doc.getElementById('btn-world-chat') as HTMLButtonElement | null,
      worldRoomChatButton: doc.getElementById('btn-world-room-chat') as HTMLButtonElement | null,
      worldJumpSheetButton: doc.getElementById('btn-world-jump-sheet') as HTMLButtonElement | null,
      worldJumpSheet: doc.getElementById('mobile-jump-sheet'),
      worldJumpSheetInput: doc.getElementById('mobile-world-jump-input') as HTMLInputElement | null,
      worldJumpSheetGoButton: doc.getElementById('btn-mobile-world-jump-go') as HTMLButtonElement | null,
      worldJumpSheetCloseButton: doc.getElementById('btn-mobile-world-jump-close') as HTMLButtonElement | null,
      worldJumpInput: doc.getElementById('world-jump-input') as HTMLInputElement | null,
      worldJumpButton: doc.getElementById('btn-world-jump') as HTMLButtonElement | null,
      chatToggleButton: doc.getElementById('btn-chat-toggle') as HTMLButtonElement | null,
    };
    this.mutationObserver = new MutationObserver(() => {
      this.render();
    });
  }

  init(): void {
    initializeDeviceLayout();
    this.doc.body.dataset.mobileEditorSheet = this.activeEditorSheet;
    this.doc.body.dataset.mobileEditorCollapsed = this.editorSheetCollapsed ? 'true' : 'false';
    this.bindDeviceLayout();
    this.bindAppMode();
    this.bindMobileEditorNav();
    this.bindMobileEditorActions();
    this.bindMobileWorldHud();
    this.bindWorldShortcuts();
    this.bindDpad();
    this.bindActionButtons();
    this.bindMobileCameraTuner();
    this.bindDoubleTapZoomSuppression();
    this.windowObj.addEventListener('mobile-editor-auto-collapse', this.handleAutoCollapse as EventListener);
    this.render();
  }

  destroy(): void {
    this.mutationObserver.disconnect();
    this.windowObj.removeEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleDeviceLayoutChanged as EventListener);
    this.windowObj.removeEventListener('mobile-editor-auto-collapse', this.handleAutoCollapse as EventListener);
    this.doc.removeEventListener('touchend', this.handleTouchEndSuppressDoubleTapZoom, true);
  }

  private readonly handleDeviceLayoutChanged = () => {
    this.render();
  };

  private readonly handleAutoCollapse = () => {
    const layout = getDeviceLayoutState();
    if (layout.deviceClass !== 'phone' || !layout.coarsePointer) {
      return;
    }

    if (this.doc.body.dataset.appMode !== 'editor') {
      return;
    }

    this.editorSheetCollapsed = true;
    this.doc.body.dataset.mobileEditorCollapsed = 'true';
    this.render();
  };

  private bindDeviceLayout(): void {
    this.windowObj.addEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleDeviceLayoutChanged as EventListener);
  }

  private bindAppMode(): void {
    this.mutationObserver.observe(this.doc.body, {
      attributes: true,
      attributeFilter: ['data-app-mode', 'data-editor-music-mode', 'data-editor-music-ui-locked'],
    });
    this.observeClassChanges(this.doc.getElementById('auth-panel'));
    this.observeClassChanges(this.doc.getElementById('global-chat'));
    this.observeClassChanges(this.doc.getElementById('busy-overlay'));
    this.doc.querySelectorAll('.history-modal').forEach((element) => {
      this.observeClassChanges(element);
    });
  }

  private observeClassChanges(target: Element | null): void {
    if (!target) {
      return;
    }

    this.mutationObserver.observe(target, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private bindMobileEditorNav(): void {
    this.elements.mobileEditorNav?.querySelectorAll<HTMLButtonElement>('[data-mobile-editor-sheet]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextSheet = button.dataset.mobileEditorSheet as EditorSheetId | undefined;
        if (!nextSheet) {
          return;
        }

        if (this.doc.body.dataset.editorMusicMode === 'true' && nextSheet !== 'actions') {
          return;
        }

        this.syncEditorPaletteMode(nextSheet);

        if (this.activeEditorSheet !== nextSheet || this.editorSheetCollapsed) {
          this.editorSheetCollapsed = false;
        }
        this.activeEditorSheet = nextSheet;
        this.doc.body.dataset.mobileEditorSheet = nextSheet;
        this.doc.body.dataset.mobileEditorCollapsed = this.editorSheetCollapsed ? 'true' : 'false';
        this.render();
      });
    });
  }

  private bindMobileEditorActions(): void {
    this.elements.mobileEditorUndoButton?.addEventListener('click', () => {
      withActiveEditorScene(this.game, (scene) => {
        scene.undoAction?.();
      });
    });

    this.elements.mobileEditorToggleButton?.addEventListener('click', () => {
      if (this.doc.body.dataset.editorMusicMode === 'true') {
        return;
      }

      if (!this.editorSheetCollapsed) {
        this.editorSheetCollapsed = true;
        this.doc.body.dataset.mobileEditorCollapsed = 'true';
        this.render();
      }
    });
  }

  private syncEditorPaletteMode(sheet: EditorSheetId): void {
    if (sheet !== 'palette' && sheet !== 'objects') {
      return;
    }

    const targetMode = sheet === 'objects' ? 'objects' : 'tiles';
    const targetButton = this.doc.querySelector<HTMLButtonElement>(`.palette-tab[data-mode="${targetMode}"]`);
    if (targetButton && !targetButton.classList.contains('active')) {
      targetButton.click();
    }
  }

  private bindMobileWorldHud(): void {
    this.elements.worldHudToggleButton?.addEventListener('click', () => {
      this.worldHudCollapsed = false;
      this.doc.body.dataset.mobileWorldHudCollapsed = 'false';
      this.render();
    });

    this.elements.worldHudMinimizeButton?.addEventListener('click', () => {
      this.worldHudCollapsed = true;
      this.doc.body.dataset.mobileWorldHudCollapsed = 'true';
      this.render();
    });
  }

  private bindWorldShortcuts(): void {
    this.elements.worldChatButton?.addEventListener('click', () => {
      this.elements.chatToggleButton?.click();
    });

    this.elements.worldRoomChatButton?.addEventListener('click', () => {
      getActiveOverworldScene(this.game)?.openRoomChatComposer?.();
    });

    this.elements.worldJumpSheetButton?.addEventListener('click', () => {
      this.openJumpSheet();
    });

    this.elements.worldJumpSheetCloseButton?.addEventListener('click', () => {
      this.closeJumpSheet();
    });

    this.elements.worldJumpSheetGoButton?.addEventListener('click', () => {
      if (this.elements.worldJumpInput && this.elements.worldJumpSheetInput) {
        this.elements.worldJumpInput.value = this.elements.worldJumpSheetInput.value;
      }
      this.elements.worldJumpButton?.click();
      this.closeJumpSheet();
    });

    this.elements.worldJumpSheetInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.elements.worldJumpSheetGoButton?.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeJumpSheet();
      }
    });
  }

  private bindDoubleTapZoomSuppression(): void {
    this.doc.addEventListener('touchend', this.handleTouchEndSuppressDoubleTapZoom, {
      passive: false,
      capture: true,
    });
  }

  private readonly handleTouchEndSuppressDoubleTapZoom = (event: TouchEvent) => {
    const layout = getDeviceLayoutState();
    if (!layout.coarsePointer) {
      return;
    }

    if (event.touches.length > 0 || event.changedTouches.length === 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (this.shouldAllowNativeDoubleTap(target)) {
      this.lastTouchEndAt = event.timeStamp;
      return;
    }

    const interval = event.timeStamp - this.lastTouchEndAt;
    this.lastTouchEndAt = event.timeStamp;
    if (interval > 0 && interval < 320 && event.cancelable) {
      event.preventDefault();
    }
  };

  private shouldAllowNativeDoubleTap(target: Element | null): boolean {
    if (!target) {
      return false;
    }

    return Boolean(
      target.closest(
        'input, textarea, select, option, label, [contenteditable=""], [contenteditable="true"]'
      )
    );
  }

  private bindDpad(): void {
    const moveZone = this.elements.mobileDpad;
    if (!moveZone) {
      return;
    }

    const release = (pointerId: number) => {
      if (!this.activeDpadPointers.has(pointerId)) {
        return;
      }

      this.activeDpadPointers.delete(pointerId);
      this.applyDpadState();
    };

    this.elements.mobileDpadButtons.forEach((button) => {
      const direction = this.getMoveDirection(button.dataset.mobileDirection);
      if (!direction) {
        return;
      }

      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.activeDpadPointers.set(event.pointerId, direction);
        this.applyDpadState();
        this.trySetPointerCapture(button, event.pointerId);
      });

      const releaseButtonPointer = (event: PointerEvent) => {
        if (this.activeDpadPointers.get(event.pointerId) !== direction) {
          return;
        }

        release(event.pointerId);
      };

      button.addEventListener('pointerup', releaseButtonPointer);
      button.addEventListener('pointercancel', releaseButtonPointer);
      button.addEventListener('lostpointercapture', releaseButtonPointer);
    });

    moveZone.addEventListener('pointerdown', (event) => {
      if (!this.isPortraitMoveZoneActive() || this.activeMovePointerId !== null) {
        return;
      }

      event.preventDefault();
      if (!this.isPointInsideMoveStick(event)) {
        return;
      }

      this.activeDpadPointers.clear();
      this.syncDpadButtonState();
      this.activeMovePointerId = event.pointerId;
      this.movePointerOrigin = { x: event.clientX, y: event.clientY };
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

    const releaseMoveZonePointer = (event: PointerEvent) => {
      if (event.pointerId !== this.activeMovePointerId) {
        return;
      }

      event.preventDefault();
      this.clearMoveZoneState();
    };

    moveZone.addEventListener('pointerup', releaseMoveZonePointer);
    moveZone.addEventListener('pointercancel', releaseMoveZonePointer);
    moveZone.addEventListener('lostpointercapture', releaseMoveZonePointer);
  }

  private getMoveDirection(direction: string | undefined): MoveDirection | null {
    if (
      direction === 'up'
      || direction === 'left'
      || direction === 'right'
      || direction === 'down'
    ) {
      return direction;
    }

    return null;
  }

  private applyDpadState(): void {
    let x = 0;
    let y = 0;

    for (const direction of this.activeDpadPointers.values()) {
      if (direction === 'left') {
        x -= 1;
      } else if (direction === 'right') {
        x += 1;
      } else if (direction === 'up') {
        y -= 1;
      } else if (direction === 'down') {
        y += 1;
      }
    }

    setTouchMove(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
    this.syncDpadButtonState();
  }

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

  private syncDpadButtonState(): void {
    const activeDirections = new Set(this.activeDpadPointers.values());
    this.elements.mobileDpadButtons.forEach((button) => {
      const direction = this.getMoveDirection(button.dataset.mobileDirection);
      button.classList.toggle('is-active', Boolean(direction && activeDirections.has(direction)));
    });
  }

  private clearDpadState(): void {
    if (this.activeDpadPointers.size > 0) {
      this.activeDpadPointers.clear();
    }

    this.activeMovePointerId = null;
    this.movePointerOrigin = null;
    this.elements.mobileDpad?.removeAttribute('data-mobile-move-active');
    this.resetMoveStickVisual();
    setTouchMove(0, 0);
    this.syncDpadButtonState();
  }

  private syncMoveStickVisual(deltaX: number, deltaY: number): void {
    const moveZone = this.elements.mobileDpad;
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
    const moveZone = this.elements.mobileDpad;
    if (!moveZone) {
      return;
    }

    moveZone.style.setProperty('--mobile-move-stick-x', '0px');
    moveZone.style.setProperty('--mobile-move-stick-y', '0px');
  }

  private clearMoveZoneState(): void {
    this.activeMovePointerId = null;
    this.movePointerOrigin = null;
    this.elements.mobileDpad?.removeAttribute('data-mobile-move-active');
    this.resetMoveStickVisual();
    setTouchMove(0, 0);
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

  private bindMobileCameraTuner(): void {
    this.elements.mobileCameraTunerButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const scene = getActiveOverworldScene(this.game);
        const action = button.dataset.mobileCameraTunerAction;
        if (!scene || !action) {
          return;
        }

        if (action === 'zoom-out') {
          scene.adjustMobilePortraitCameraTuning?.(
            { zoomMultiplierDelta: -0.05 },
            'button-zoom-out',
          );
        } else if (action === 'zoom-in') {
          scene.adjustMobilePortraitCameraTuning?.(
            { zoomMultiplierDelta: 0.05 },
            'button-zoom-in',
          );
        } else if (action === 'player-up') {
          scene.adjustMobilePortraitCameraTuning?.(
            { targetYDelta: -0.03 },
            'button-player-up',
          );
        } else if (action === 'player-down') {
          scene.adjustMobilePortraitCameraTuning?.(
            { targetYDelta: 0.03 },
            'button-player-down',
          );
        } else if (action === 'reset') {
          scene.resetMobilePortraitCameraTuning?.();
        } else if (action === 'log') {
          scene.logMobilePortraitCameraTuning?.('button-log');
        }

        this.render();
      });
    });
  }

  private bindHoldButton(button: HTMLButtonElement | null, action: 'jump' | 'slash' | 'shoot'): void {
    if (!button) {
      return;
    }

    const release = () => {
      setTouchActionHeld(action, false);
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      setTouchActionHeld(action, true);
      pressTouchAction(action);
      this.trySetPointerCapture(button, event.pointerId);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  private openJumpSheet(): void {
    const jumpSheet = this.elements.worldJumpSheet;
    if (!jumpSheet) {
      return;
    }

    if (this.elements.worldJumpInput && this.elements.worldJumpSheetInput) {
      this.elements.worldJumpSheetInput.value = this.elements.worldJumpInput.value;
    }

    if (!jumpSheet.classList.contains('hidden')) {
      this.elements.worldJumpSheetInput?.focus();
      this.elements.worldJumpSheetInput?.select();
      return;
    }

    jumpSheet.classList.remove('hidden');
    this.doc.body.dataset.mobileJumpSheetOpen = 'true';
    this.elements.worldJumpSheetInput?.focus();
    this.elements.worldJumpSheetInput?.select();
  }

  private closeJumpSheet(): void {
    const jumpSheet = this.elements.worldJumpSheet;
    if (!jumpSheet) {
      delete this.doc.body.dataset.mobileJumpSheetOpen;
      return;
    }

    if (jumpSheet.classList.contains('hidden')) {
      delete this.doc.body.dataset.mobileJumpSheetOpen;
      return;
    }

    jumpSheet.classList.add('hidden');
    delete this.doc.body.dataset.mobileJumpSheetOpen;
  }

  private trySetPointerCapture(button: HTMLElement, pointerId: number): void {
    if (typeof button.setPointerCapture !== 'function') {
      return;
    }

    try {
      button.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointer flows and some browser edge cases can reject capture.
    }
  }

  private hasVisibleNonJumpModal(): boolean {
    return Array.from(this.doc.querySelectorAll<HTMLElement>('.history-modal')).some((element) => {
      if (element === this.elements.worldJumpSheet) {
        return false;
      }

      return !element.classList.contains('hidden');
    });
  }

  private render(): void {
    const layout = getDeviceLayoutState();
    const appMode = this.doc.body.dataset.appMode ?? 'world';
    const isPhone = layout.deviceClass === 'phone';
    const isEditor = appMode === 'editor';
    const musicModeActive = this.doc.body.dataset.editorMusicMode === 'true';
    const isWorld = appMode === 'world' || appMode === 'play-world';
    const isPlay = appMode === 'play-world';
    const hasFocusedRoomLink = hasFocusedRoomCoordinateLink(this.windowObj.location.search);
    const isPortraitFocusedRoom =
      isPhone &&
      layout.coarsePointer &&
      layout.orientationState === 'portrait' &&
      isWorld &&
      (isPlay || hasFocusedRoomLink);
    const isPortraitPlay = isPortraitFocusedRoom && isPlay;
    const orientationBlocked = layout.mobileLandscapeBlocked && !isPortraitFocusedRoom;
    const isCollapsibleWorldHud =
      layout.coarsePointer &&
      layout.deviceClass !== 'desktop' &&
      !orientationBlocked &&
      isWorld;
    const chatOpen = this.doc.getElementById('global-chat')?.classList.contains('is-open') ?? false;
    const jumpSheetOpen = !(this.elements.worldJumpSheet?.classList.contains('hidden') ?? true);
    const menuOpen = this.doc.getElementById('auth-panel')?.classList.contains('menu-open') ?? false;
    const busyOverlayOpen = !(this.doc.getElementById('busy-overlay')?.classList.contains('hidden') ?? true);
    const nonJumpModalOpen = this.hasVisibleNonJumpModal();
    const mobileShortcutOverlayOpen =
      chatOpen || jumpSheetOpen || menuOpen || busyOverlayOpen || nonJumpModalOpen;
    const shouldPauseForOrientation = orientationBlocked;

    if (isPortraitFocusedRoom && (this.windowObj.scrollX !== 0 || this.windowObj.scrollY !== 0)) {
      this.windowObj.scrollTo(0, 0);
    }

    if (!isEditor && this.editorSheetCollapsed) {
      this.editorSheetCollapsed = false;
    }

    if (isEditor && musicModeActive) {
      this.activeEditorSheet = 'actions';
      this.editorSheetCollapsed = false;
      this.doc.body.dataset.mobileEditorSheet = 'actions';
    }

    if (this.previousAppMode !== appMode) {
      if (layout.coarsePointer && layout.deviceClass !== 'desktop') {
        if (appMode === 'play-world') {
          this.worldHudCollapsed = true;
        } else if (appMode === 'world') {
          this.worldHudCollapsed = false;
        }
      } else {
        this.worldHudCollapsed = false;
      }
      this.previousAppMode = appMode;
    }

    this.doc.body.dataset.mobileControlsVisible =
      layout.coarsePointer && !orientationBlocked && isPlay ? 'true' : 'false';
    this.doc.body.dataset.mobilePortraitPlay = isPortraitPlay ? 'true' : 'false';
    this.doc.body.dataset.mobilePortraitFocusedRoom = isPortraitFocusedRoom ? 'true' : 'false';

    if (this.elements.mobileEditorNav) {
      this.elements.mobileEditorNav.classList.toggle(
        'hidden',
        !(isPhone && layout.coarsePointer && !orientationBlocked && isEditor),
      );
      this.elements.mobileEditorNav
        .querySelectorAll<HTMLButtonElement>('[data-mobile-editor-sheet]')
        .forEach((button) => {
          button.classList.toggle('active', button.dataset.mobileEditorSheet === this.activeEditorSheet);
          button.disabled = musicModeActive && button.dataset.mobileEditorSheet !== 'actions';
        });
    }

    this.doc.body.dataset.mobileEditorCollapsed = this.editorSheetCollapsed ? 'true' : 'false';
    if (this.elements.mobileEditorUndoButton) {
      this.elements.mobileEditorUndoButton.disabled = musicModeActive;
    }
    if (this.elements.mobileEditorToggleButton) {
      this.elements.mobileEditorToggleButton.disabled = musicModeActive;
    }

    this.elements.rotateGate?.classList.toggle(
      'hidden',
      !orientationBlocked,
    );

    this.elements.mobilePlayControls?.classList.toggle(
      'hidden',
      !(layout.coarsePointer && !orientationBlocked && isPlay),
    );
    this.elements.mobileWorldStopButton?.classList.toggle(
      'hidden',
      !(isCollapsibleWorldHud && isPlay && this.worldHudCollapsed),
    );
    this.elements.mobileWorldRestartButton?.classList.toggle(
      'hidden',
      !(isCollapsibleWorldHud && isPlay && this.worldHudCollapsed),
    );
    this.elements.mobileCameraTuner?.classList.toggle(
      'hidden',
      !(this.isMobileCameraTunerUrlEnabled() && isPortraitPlay && !mobileShortcutOverlayOpen),
    );
    this.syncMobileCameraTunerValue();

    this.doc.body.dataset.mobileWorldHudCollapsed =
      isCollapsibleWorldHud && this.worldHudCollapsed ? 'true' : 'false';
    this.elements.worldHudToggleButton?.classList.toggle(
      'hidden',
      !(isCollapsibleWorldHud && this.worldHudCollapsed),
    );
    this.elements.worldHudMinimizeButton?.classList.toggle(
      'hidden',
      !(isCollapsibleWorldHud && !this.worldHudCollapsed),
    );

    this.elements.worldChatButton?.classList.toggle(
      'hidden',
      !(layout.coarsePointer && isWorld) || mobileShortcutOverlayOpen,
    );
    this.elements.worldRoomChatButton?.classList.toggle(
      'hidden',
      !(layout.coarsePointer && isPlay) || mobileShortcutOverlayOpen,
    );
    this.elements.worldJumpSheetButton?.classList.toggle(
      'hidden',
      !(layout.coarsePointer && isWorld) || mobileShortcutOverlayOpen,
    );
    if (!(layout.coarsePointer && isWorld) || chatOpen || menuOpen || busyOverlayOpen || nonJumpModalOpen) {
      this.closeJumpSheet();
    }

    setTouchControlsActive(layout.coarsePointer && isPlay && !orientationBlocked);
    if (!layout.coarsePointer || orientationBlocked || !isPlay) {
      resetTouchInputState();
      this.clearDpadState();
    }

    if (shouldPauseForOrientation) {
      this.pauseInteractiveScenes();
    } else {
      this.resumeInteractiveScenes();
    }
  }

  private isMobileCameraTunerUrlEnabled(): boolean {
    const params = new URLSearchParams(this.windowObj.location.search);
    const raw =
      params.get('cameraTuner')
      ?? params.get('mobileCameraTuner')
      ?? params.get('cameraDebug');
    if (raw === null) {
      return params.has('mobileCameraZoom') || params.has('mobileCameraTargetY');
    }

    const normalized = raw.trim().toLowerCase();
    return normalized === '' || ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  private syncMobileCameraTunerValue(): void {
    const valueElement = this.elements.mobileCameraTunerValue;
    if (!valueElement) {
      return;
    }

    const snapshot = getActiveOverworldScene(this.game)?.getMobilePortraitCameraTuning?.();
    if (!snapshot) {
      valueElement.textContent = 'waiting for camera';
      return;
    }

    valueElement.textContent =
      `zoom x${snapshot.zoomMultiplier.toFixed(2)} `
      + `target ${snapshot.targetY.toFixed(2)} `
      + `cam ${snapshot.cameraZoom.toFixed(2)}`;
  }

  private pauseInteractiveScenes(): void {
    for (const sceneKey of ['OverworldPlayScene', 'EditorScene']) {
      if (this.game.scene.isActive(sceneKey)) {
        this.game.scene.pause(sceneKey);
        this.pausedSceneKeys.add(sceneKey);
      }
    }
  }

  private resumeInteractiveScenes(): void {
    for (const sceneKey of [...this.pausedSceneKeys]) {
      if (this.game.scene.isPaused(sceneKey)) {
        this.game.scene.resume(sceneKey);
      }
      this.pausedSceneKeys.delete(sceneKey);
    }
  }
}
