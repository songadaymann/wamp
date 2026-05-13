import Phaser from 'phaser';
import { getGameSettings } from '../../settings/userSettings';
import { RETRO_COLORS } from '../../visuals/starfield';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { OverworldMode } from '../sceneData';
import {
  getScreenAnchorWorldPoint as calculateScreenAnchorWorldPoint,
  getScrollForScreenAnchor as calculateScrollForScreenAnchor,
  type CameraMode,
} from './camera';

const CONTINUOUS_ZOOM_REFRESH_DEBOUNCE_MS = 120;

export interface ZoomDebugState {
  source: 'canvas-wheel';
  rawClient: { x: number; y: number };
  screen: { x: number; y: number };
  phaserPointer: { x: number; y: number };
  deltaY: number;
  anchorWorldBefore: { x: number; y: number };
  anchorWorldAfter: { x: number; y: number };
  zoom: { before: number; after: number };
  scroll: {
    beforeX: number;
    beforeY: number;
    afterX: number;
    afterY: number;
  };
  mode: OverworldMode;
  cameraMode: CameraMode;
  selected: RoomCoordinates;
  currentRoom: RoomCoordinates;
}

interface OverworldViewportControllerHost {
  scene: Phaser.Scene;
  getMode(): OverworldMode;
  getCameraMode(): CameraMode;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getInspectZoom(): number;
  setInspectZoom(zoom: number): void;
  getBrowseInspectZoom(): number;
  setBrowseInspectZoom(zoom: number): void;
  getZoomFocusCoordinates(): RoomCoordinates;
  centerCameraOnCoordinates(coordinates: RoomCoordinates): void;
  startFollowCamera(camera: Phaser.Cameras.Scene2D.Camera): void;
  constrainInspectCamera(): void;
  refreshChunkWindowIfNeeded(centerCoordinates: RoomCoordinates): void;
  updateBackdrop(): void;
  redrawWorldCells(): void;
  redrawGridOverlay(): void;
  renderHud(): void;
  getSelectedCoordinates(): RoomCoordinates;
  getCurrentRoomCoordinates(): RoomCoordinates;
}

interface OverworldViewportControllerOptions {
  minZoom: number;
  maxZoom: number;
  buttonZoomFactor: number;
  wheelZoomSensitivity: number;
  measurePerformance?: <T>(label: string, callback: () => T) => T;
}

export class OverworldViewportController {
  private zoomDebugText: Phaser.GameObjects.Text | null = null;
  private zoomDebugGraphics: Phaser.GameObjects.Graphics | null = null;
  private zoomDebugEnabled = false;
  private lastZoomDebug: ZoomDebugState | null = null;
  private postZoomRefreshTimer: number | null = null;

  private readonly handleCanvasWheel = (event: WheelEvent): void => {
    const appMode = document.body.dataset.appMode;
    if (appMode !== 'world' && appMode !== 'play-world') {
      return;
    }

    const rect = this.host.scene.game.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const screenX = ((event.clientX - rect.left) / rect.width) * this.host.scene.scale.width;
    const screenY = ((event.clientY - rect.top) / rect.height) * this.host.scene.scale.height;

    if (
      screenX < 0 ||
      screenX > this.host.scene.scale.width ||
      screenY < 0 ||
      screenY > this.host.scene.scale.height
    ) {
      return;
    }

    event.preventDefault();

    const settings = getGameSettings();
    if (settings.panningStyle === 'two-finger-drag' && !event.ctrlKey) {
      this.handleWheelPan(event.deltaX, event.deltaY, event.deltaMode);
      return;
    }

    const camera = this.host.scene.cameras.main;
    const beforeZoom = camera.zoom;
    const beforeScrollX = camera.scrollX;
    const beforeScrollY = camera.scrollY;
    const anchorWorldBefore = calculateScreenAnchorWorldPoint(screenX, screenY, camera);
    const phaserPointer = {
      x: this.host.scene.input.activePointer.x,
      y: this.host.scene.input.activePointer.y,
    };

    this.handleWheelZoom(screenX, screenY, event.deltaY);

    const anchorWorldAfter = calculateScreenAnchorWorldPoint(screenX, screenY, camera);
    this.recordZoomDebug({
      source: 'canvas-wheel',
      rawClient: { x: event.clientX, y: event.clientY },
      screen: { x: screenX, y: screenY },
      phaserPointer,
      deltaY: event.deltaY,
      anchorWorldBefore: { x: anchorWorldBefore.x, y: anchorWorldBefore.y },
      anchorWorldAfter: { x: anchorWorldAfter.x, y: anchorWorldAfter.y },
      zoom: { before: beforeZoom, after: camera.zoom },
      scroll: {
        beforeX: beforeScrollX,
        beforeY: beforeScrollY,
        afterX: camera.scrollX,
        afterY: camera.scrollY,
      },
      mode: this.host.getMode(),
      cameraMode: this.host.getCameraMode(),
      selected: { ...this.host.getSelectedCoordinates() },
      currentRoom: { ...this.host.getCurrentRoomCoordinates() },
    });
  };

  constructor(
    private readonly host: OverworldViewportControllerHost,
    private readonly options: OverworldViewportControllerOptions
  ) {}

  private measure<T>(label: string, callback: () => T): T {
    return this.options.measurePerformance
      ? this.options.measurePerformance(label, callback)
      : callback();
  }

  setZoomDebugEnabled(enabled: boolean): void {
    this.zoomDebugEnabled = enabled;
  }

  initialize(): void {
    this.zoomDebugGraphics = this.host.scene.add.graphics();
    this.zoomDebugGraphics.setDepth(240);
    this.zoomDebugGraphics.setScrollFactor(0);

    this.zoomDebugText = this.host.scene.add.text(0, 0, '', {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color: '#7de5ff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: { x: 8, y: 6 },
    });
    this.zoomDebugText.setDepth(241);
    this.zoomDebugText.setScrollFactor(0);
    this.zoomDebugText.setVisible(this.zoomDebugEnabled);

    this.updateDebugOverlay();
    this.host.scene.game.canvas.addEventListener('wheel', this.handleCanvasWheel, {
      passive: false,
    });
    (
      window as Window & { get_zoom_debug?: () => ZoomDebugState | null }
    ).get_zoom_debug = () => this.lastZoomDebug;
  }

  destroy(): void {
    this.cancelScheduledPostZoomRefresh();
    this.host.scene.game.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    delete (window as Window & { get_zoom_debug?: () => ZoomDebugState | null }).get_zoom_debug;
    this.zoomDebugGraphics?.destroy();
    this.zoomDebugGraphics = null;
    this.zoomDebugText?.destroy();
    this.zoomDebugText = null;
    this.lastZoomDebug = null;
  }

  handleResize(): void {
    this.updateDebugOverlay();
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const ignored: Phaser.GameObjects.GameObject[] = [];
    if (this.zoomDebugGraphics) ignored.push(this.zoomDebugGraphics);
    if (this.zoomDebugText) ignored.push(this.zoomDebugText);
    return ignored;
  }

  zoomIn(): void {
    this.adjustButtonZoom(this.options.buttonZoomFactor);
  }

  zoomOut(): void {
    this.adjustButtonZoom(1 / this.options.buttonZoomFactor);
  }

  adjustZoomByFactor(factor: number, screenX?: number, screenY?: number): void {
    this.measure('zoom.adjustZoomByFactor', () => {
      const camera = this.host.scene.cameras.main;
      const anchorX = screenX ?? camera.width * 0.5;
      const anchorY = screenY ?? camera.height * 0.5;
      const shouldDeferPostZoomRefresh = screenX !== undefined || screenY !== undefined;
      const nextZoom = Phaser.Math.Clamp(
        camera.zoom * factor,
        this.options.minZoom,
        this.options.maxZoom
      );
      if (Math.abs(nextZoom - camera.zoom) < 0.0001) {
        return;
      }

      const anchorWorldPoint = calculateScreenAnchorWorldPoint(anchorX, anchorY, camera);
      this.host.setInspectZoom(Number(nextZoom.toFixed(3)));
      if (this.host.getMode() === 'browse') {
        this.host.setBrowseInspectZoom(this.host.getInspectZoom());
      }
      camera.setZoom(this.host.getInspectZoom());

      this.measure('zoom.camera', () => {
        if (
          this.host.getMode() === 'play' &&
          this.host.getCameraMode() === 'follow' &&
          this.host.getPlayer()
        ) {
          this.host.startFollowCamera(camera);
          return;
        }

        const nextScroll = calculateScrollForScreenAnchor(
          anchorWorldPoint.x,
          anchorWorldPoint.y,
          anchorX,
          anchorY,
          camera
        );
        camera.setScroll(nextScroll.x, nextScroll.y);
        this.host.constrainInspectCamera();
      });

      if (shouldDeferPostZoomRefresh) {
        this.schedulePostZoomRefresh();
      } else {
        this.cancelScheduledPostZoomRefresh();
        this.runPostZoomRefresh();
      }
    });
  }

  private adjustButtonZoom(factor: number): void {
    this.measure('zoom.adjustButtonZoom', () => {
      if (
        this.host.getMode() === 'play' &&
        this.host.getCameraMode() === 'follow' &&
        this.host.getPlayer()
      ) {
        this.adjustZoomByFactor(factor);
        return;
      }

      const camera = this.host.scene.cameras.main;
      const nextZoom = Phaser.Math.Clamp(
        camera.zoom * factor,
        this.options.minZoom,
        this.options.maxZoom
      );
      if (Math.abs(nextZoom - camera.zoom) < 0.0001) {
        return;
      }

      this.host.setInspectZoom(Number(nextZoom.toFixed(3)));
      if (this.host.getMode() === 'browse') {
        this.host.setBrowseInspectZoom(this.host.getInspectZoom());
      }
      camera.setZoom(this.host.getInspectZoom());
      this.measure('zoom.centerCamera', () =>
        this.host.centerCameraOnCoordinates(this.host.getZoomFocusCoordinates())
      );
      this.cancelScheduledPostZoomRefresh();
      this.runPostZoomRefresh();
    });
  }

  private handleWheelZoom(screenX: number, screenY: number, deltaY: number): void {
    const zoomFactor = Phaser.Math.Clamp(
      Math.exp(-deltaY * this.options.wheelZoomSensitivity),
      0.92,
      1.08
    );
    this.adjustZoomByFactor(zoomFactor, screenX, screenY);
  }

  private handleWheelPan(deltaX: number, deltaY: number, deltaMode: number): void {
    if (this.host.getMode() !== 'browse' && this.host.getCameraMode() !== 'inspect') {
      return;
    }

    const camera = this.host.scene.cameras.main;
    const normalizedDelta = this.normalizeWheelPanDelta(deltaX, deltaY, deltaMode);
    camera.setScroll(
      camera.scrollX + normalizedDelta.x / camera.zoom,
      camera.scrollY + normalizedDelta.y / camera.zoom,
    );
    this.host.constrainInspectCamera();
    this.schedulePostZoomRefresh();
  }

  private normalizeWheelPanDelta(
    deltaX: number,
    deltaY: number,
    deltaMode: number,
  ): { x: number; y: number } {
    if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return {
        x: deltaX * 16,
        y: deltaY * 16,
      };
    }

    if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return {
        x: deltaX * this.host.scene.scale.width,
        y: deltaY * this.host.scene.scale.height,
      };
    }

    return { x: deltaX, y: deltaY };
  }

  private schedulePostZoomRefresh(): void {
    this.measure('zoom.schedulePostZoomRefresh', () => {
      this.cancelScheduledPostZoomRefresh();
      this.postZoomRefreshTimer = window.setTimeout(
        () => {
          this.postZoomRefreshTimer = null;
          this.runPostZoomRefresh();
        },
        CONTINUOUS_ZOOM_REFRESH_DEBOUNCE_MS,
      );
    });
  }

  private cancelScheduledPostZoomRefresh(): void {
    if (this.postZoomRefreshTimer !== null) {
      window.clearTimeout(this.postZoomRefreshTimer);
    }
    this.postZoomRefreshTimer = null;
  }

  private runPostZoomRefresh(): void {
    const focusCoordinates = this.host.getZoomFocusCoordinates();
    this.measure('zoom.refreshChunkWindowIfNeeded', () =>
      this.host.refreshChunkWindowIfNeeded(focusCoordinates)
    );
    this.measure('zoom.updateBackdrop', () => this.host.updateBackdrop());
    this.measure('zoom.redrawWorldCells', () => this.host.redrawWorldCells());
    this.measure('zoom.redrawGridOverlay', () => this.host.redrawGridOverlay());
    this.measure('zoom.renderHud', () => this.host.renderHud());
  }

  private updateDebugOverlay(): void {
    if (this.zoomDebugText) {
      this.zoomDebugText.setPosition(Math.max(16, this.host.scene.scale.width - 320), 16);
      this.zoomDebugText.setVisible(this.zoomDebugEnabled);
    }

    if (!this.zoomDebugEnabled && this.zoomDebugGraphics) {
      this.zoomDebugGraphics.clear();
    }
  }

  private recordZoomDebug(debugState: ZoomDebugState): void {
    this.lastZoomDebug = debugState;

    if (!this.zoomDebugEnabled) {
      return;
    }

    if (this.zoomDebugGraphics) {
      const { x, y } = debugState.screen;
      this.zoomDebugGraphics.clear();
      this.zoomDebugGraphics.lineStyle(1, RETRO_COLORS.draft, 0.95);
      this.zoomDebugGraphics.strokeCircle(x, y, 12);
      this.zoomDebugGraphics.lineBetween(x - 18, y, x + 18, y);
      this.zoomDebugGraphics.lineBetween(x, y - 18, x, y + 18);
    }

    if (this.zoomDebugText) {
      this.zoomDebugText.setText([
        'zoomDebug',
        `screen ${debugState.screen.x.toFixed(1)}, ${debugState.screen.y.toFixed(1)}`,
        `phaser ${debugState.phaserPointer.x.toFixed(1)}, ${debugState.phaserPointer.y.toFixed(1)}`,
        `world ${debugState.anchorWorldBefore.x.toFixed(1)}, ${debugState.anchorWorldBefore.y.toFixed(1)}`,
        `zoom ${debugState.zoom.before.toFixed(3)} -> ${debugState.zoom.after.toFixed(3)}`,
        `scroll ${debugState.scroll.beforeX.toFixed(1)}, ${debugState.scroll.beforeY.toFixed(1)}`,
        `     -> ${debugState.scroll.afterX.toFixed(1)}, ${debugState.scroll.afterY.toFixed(1)}`,
      ]);
      this.zoomDebugText.setVisible(true);
    }

    console.info('[zoom-debug]', debugState);
  }
}
