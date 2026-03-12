import Phaser from 'phaser';
import { getDeviceLayoutState, initializeDeviceLayout, DEVICE_LAYOUT_CHANGED_EVENT } from '../deviceLayout';
import { withActiveEditorScene } from '../setup/sceneBridge';
import {
  pressTouchAction,
  resetTouchInputState,
  setTouchActionHeld,
  setTouchControlsActive,
  setTouchMove,
} from './touchControls';

type EditorSheetId = 'tools' | 'palette' | 'objects' | 'goal' | 'actions';

type Elements = {
  rotateGate: HTMLElement | null;
  mobileEditorNav: HTMLElement | null;
  mobileEditorUndoButton: HTMLButtonElement | null;
  mobileEditorToggleButton: HTMLButtonElement | null;
  mobilePlayControls: HTMLElement | null;
  mobileJoystick: HTMLElement | null;
  mobileJoystickKnob: HTMLElement | null;
  mobileJumpButton: HTMLButtonElement | null;
  mobileSlashButton: HTMLButtonElement | null;
  mobileShootButton: HTMLButtonElement | null;
  mobileStopButton: HTMLButtonElement | null;
  mobileCameraButton: HTMLButtonElement | null;
  worldHudToggleButton: HTMLButtonElement | null;
  worldHudMinimizeButton: HTMLButtonElement | null;
  worldChatButton: HTMLButtonElement | null;
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
  private joystickPointerId: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private joystickRadius = 1;

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
      mobileJoystick: doc.getElementById('mobile-joystick'),
      mobileJoystickKnob: doc.getElementById('mobile-joystick-knob'),
      mobileJumpButton: doc.getElementById('btn-mobile-jump') as HTMLButtonElement | null,
      mobileSlashButton: doc.getElementById('btn-mobile-slash') as HTMLButtonElement | null,
      mobileShootButton: doc.getElementById('btn-mobile-shoot') as HTMLButtonElement | null,
      mobileStopButton: doc.getElementById('btn-mobile-stop') as HTMLButtonElement | null,
      mobileCameraButton: doc.getElementById('btn-mobile-camera') as HTMLButtonElement | null,
      worldHudToggleButton: doc.getElementById('btn-world-hud-toggle') as HTMLButtonElement | null,
      worldHudMinimizeButton: doc.getElementById('btn-mobile-world-hud-minimize') as HTMLButtonElement | null,
      worldChatButton: doc.getElementById('btn-world-chat') as HTMLButtonElement | null,
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
    this.bindJoystick();
    this.bindActionButtons();
    this.windowObj.addEventListener('mobile-editor-auto-collapse', this.handleAutoCollapse as EventListener);
    this.render();
  }

  destroy(): void {
    this.mutationObserver.disconnect();
    this.windowObj.removeEventListener(DEVICE_LAYOUT_CHANGED_EVENT, this.handleDeviceLayoutChanged as EventListener);
    this.windowObj.removeEventListener('mobile-editor-auto-collapse', this.handleAutoCollapse as EventListener);
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
      attributeFilter: ['data-app-mode'],
    });
  }

  private bindMobileEditorNav(): void {
    this.elements.mobileEditorNav?.querySelectorAll<HTMLButtonElement>('[data-mobile-editor-sheet]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextSheet = button.dataset.mobileEditorSheet as EditorSheetId | undefined;
        if (!nextSheet) {
          return;
        }

        if (this.activeEditorSheet === nextSheet && this.editorSheetCollapsed) {
          this.editorSheetCollapsed = false;
        } else if (this.activeEditorSheet === nextSheet) {
          this.editorSheetCollapsed = !this.editorSheetCollapsed;
        } else {
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
      this.editorSheetCollapsed = !this.editorSheetCollapsed;
      this.doc.body.dataset.mobileEditorCollapsed = this.editorSheetCollapsed ? 'true' : 'false';
      this.render();
    });
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

  private bindJoystick(): void {
    const joystick = this.elements.mobileJoystick;
    if (!joystick) {
      return;
    }

    const release = () => {
      this.joystickPointerId = null;
      setTouchMove(0, 0);
      this.updateJoystickKnob(0, 0);
    };

    const updateFromEvent = (event: PointerEvent) => {
      if (this.joystickPointerId !== event.pointerId) {
        return;
      }

      const dx = event.clientX - this.joystickCenter.x;
      const dy = event.clientY - this.joystickCenter.y;
      const distance = Math.min(this.joystickRadius, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const knobX = Math.cos(angle) * distance;
      const knobY = Math.sin(angle) * distance;
      const normalizedX = Math.abs(knobX / this.joystickRadius) < 0.12 ? 0 : knobX / this.joystickRadius;
      const normalizedY = Math.abs(knobY / this.joystickRadius) < 0.12 ? 0 : knobY / this.joystickRadius;
      setTouchMove(normalizedX, normalizedY);
      this.updateJoystickKnob(knobX, knobY);
    };

    joystick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const rect = joystick.getBoundingClientRect();
      this.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      this.joystickRadius = rect.width * 0.32;
      this.joystickPointerId = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      updateFromEvent(event);
    });

    joystick.addEventListener('pointermove', updateFromEvent);
    joystick.addEventListener('pointerup', release);
    joystick.addEventListener('pointercancel', release);
    joystick.addEventListener('lostpointercapture', release);
  }

  private bindActionButtons(): void {
    this.bindHoldButton(this.elements.mobileJumpButton, 'jump');
    this.bindHoldButton(this.elements.mobileSlashButton, 'slash');
    this.bindHoldButton(this.elements.mobileShootButton, 'shoot');

    this.elements.mobileStopButton?.addEventListener('click', () => {
      pressTouchAction('stop');
    });
    this.elements.mobileCameraButton?.addEventListener('click', () => {
      pressTouchAction('cameraToggle');
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
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  private openJumpSheet(): void {
    if (!this.elements.worldJumpSheet) {
      return;
    }

    if (this.elements.worldJumpInput && this.elements.worldJumpSheetInput) {
      this.elements.worldJumpSheetInput.value = this.elements.worldJumpInput.value;
    }

    this.elements.worldJumpSheet.classList.remove('hidden');
    this.doc.body.dataset.mobileJumpSheetOpen = 'true';
    this.elements.worldJumpSheetInput?.focus();
    this.elements.worldJumpSheetInput?.select();
  }

  private closeJumpSheet(): void {
    this.elements.worldJumpSheet?.classList.add('hidden');
    delete this.doc.body.dataset.mobileJumpSheetOpen;
  }

  private updateJoystickKnob(x: number, y: number): void {
    if (!this.elements.mobileJoystickKnob) {
      return;
    }

    this.elements.mobileJoystickKnob.style.transform = `translate(${x}px, ${y}px)`;
  }

  private render(): void {
    const layout = getDeviceLayoutState();
    const appMode = this.doc.body.dataset.appMode ?? 'world';
    const isPhone = layout.deviceClass === 'phone';
    const isEditor = appMode === 'editor';
    const isWorld = appMode === 'world' || appMode === 'play-world';
    const isPlay = appMode === 'play-world';
    const isPhoneWorld = layout.deviceClass === 'phone' && layout.coarsePointer && !layout.mobileLandscapeBlocked && isWorld;
    const chatOpen = this.doc.getElementById('global-chat')?.classList.contains('is-open') ?? false;
    const jumpSheetOpen = !(this.elements.worldJumpSheet?.classList.contains('hidden') ?? true);

    if (!isEditor && this.editorSheetCollapsed) {
      this.editorSheetCollapsed = false;
    }

    if (this.previousAppMode !== appMode) {
      if (layout.deviceClass === 'phone' && layout.coarsePointer) {
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
      layout.coarsePointer && !layout.mobileLandscapeBlocked && isPlay ? 'true' : 'false';

    if (this.elements.mobileEditorNav) {
      this.elements.mobileEditorNav.classList.toggle(
        'hidden',
        !(isPhone && layout.coarsePointer && !layout.mobileLandscapeBlocked && isEditor),
      );
      this.elements.mobileEditorToggleButton && (this.elements.mobileEditorToggleButton.textContent = this.editorSheetCollapsed ? 'Show' : 'Hide');
      this.elements.mobileEditorNav
        .querySelectorAll<HTMLButtonElement>('[data-mobile-editor-sheet]')
        .forEach((button) => {
          button.classList.toggle('active', button.dataset.mobileEditorSheet === this.activeEditorSheet);
        });
    }

    this.doc.body.dataset.mobileEditorCollapsed = this.editorSheetCollapsed ? 'true' : 'false';

    this.elements.rotateGate?.classList.toggle(
      'hidden',
      !layout.mobileLandscapeBlocked,
    );

    this.elements.mobilePlayControls?.classList.toggle(
      'hidden',
      !(layout.coarsePointer && !layout.mobileLandscapeBlocked && isPlay),
    );

    this.doc.body.dataset.mobileWorldHudCollapsed =
      isPhoneWorld && this.worldHudCollapsed ? 'true' : 'false';
    this.elements.worldHudToggleButton?.classList.toggle('hidden', !(isPhoneWorld && this.worldHudCollapsed));
    this.elements.worldHudMinimizeButton?.classList.toggle('hidden', !(isPhoneWorld && !this.worldHudCollapsed));

    this.elements.worldChatButton?.classList.toggle('hidden', !(layout.coarsePointer && isWorld) || chatOpen);
    this.elements.worldJumpSheetButton?.classList.toggle('hidden', !(layout.coarsePointer && isWorld) || jumpSheetOpen);
    if (!(layout.coarsePointer && isWorld)) {
      this.closeJumpSheet();
    }

    setTouchControlsActive(layout.coarsePointer && isPlay && !layout.mobileLandscapeBlocked);
    if (!layout.coarsePointer || layout.mobileLandscapeBlocked || !isPlay) {
      resetTouchInputState();
      this.updateJoystickKnob(0, 0);
    }

    if (layout.mobileLandscapeBlocked) {
      this.pauseInteractiveScenes();
    } else {
      this.resumeInteractiveScenes();
    }
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
