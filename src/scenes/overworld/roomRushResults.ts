import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../../config';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { RoomRushOverworldCapture } from '../../social/roomRushShare';
import {
  requestRoomRushResultShare,
} from '../../ui/setup/roomRushResultEvents';
import type { OverworldMode } from '../sceneData';
import type { ActiveRoomRushRunState } from './roomRushRuns';
import type { WorldRefreshResult } from './worldStreaming';

export interface RoomRushOverviewCameraState {
  centerWorldX: number;
  centerWorldY: number;
  constrainCamera: boolean;
  focusCoordinates: RoomCoordinates;
  overviewZoom: number;
}

interface RoomRushResultOverview {
  focusCoordinates: RoomCoordinates;
}

interface OverworldRoomRushResultControllerHost {
  getMode: () => OverworldMode;
  returnToWorld: () => void;
  showTransientStatus: (message: string) => void;
  applyOverviewCameraState: (state: RoomRushOverviewCameraState) => void;
  refreshAround: (coordinates: RoomCoordinates) => Promise<WorldRefreshResult>;
  setWindowCenterCoordinates: (coordinates: RoomCoordinates) => void;
  syncPresenceSubscriptions: () => void;
  updateCameraBounds: () => void;
  flushPendingPreviewTextureBuilds: () => void;
  syncPreviewVisibility: () => void;
  updateBackdrop: () => void;
  redrawWorld: () => void;
  renderHud: () => void;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
}

export class OverworldRoomRushResultController {
  private lastSharedRunId: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldRoomRushResultControllerHost,
    private readonly settings: {
      minZoom: number;
      maxZoom: number;
    },
  ) {}

  reset(): void {
    this.lastSharedRunId = null;
  }

  showResult(snapshot: ActiveRoomRushRunState | null, finalStatus: string | null): void {
    if (!snapshot || snapshot.result === 'active' || snapshot.runId === this.lastSharedRunId) {
      return;
    }

    this.lastSharedRunId = snapshot.runId;
    void this.showWhenOverviewReady(snapshot, finalStatus);
  }

  getOverworldCapture(runState: ActiveRoomRushRunState): RoomRushOverworldCapture | null {
    const source = this.scene.game.canvas;
    if (!source) {
      return null;
    }

    const camera = this.scene.cameras.main;
    const route = this.getRenderableRoute(runState);
    const routePoints = route.map((step) => {
      const origin = this.host.getRoomOrigin(step.coordinates);
      const worldX = origin.x + ROOM_PX_WIDTH / 2;
      const worldY = origin.y + ROOM_PX_HEIGHT / 2;
      return {
        x: (worldX - camera.worldView.x) * camera.zoom + camera.x,
        y: (worldY - camera.worldView.y) * camera.zoom + camera.y,
      };
    });

    return {
      source,
      sourceWidth: source.width,
      sourceHeight: source.height,
      routePoints,
    };
  }

  private async showWhenOverviewReady(
    snapshot: ActiveRoomRushRunState,
    finalStatus: string | null,
  ): Promise<void> {
    if (this.host.getMode() === 'play') {
      this.host.returnToWorld();
    }
    const overview = this.prepareOverview(snapshot, {
      constrainCamera: false,
    });
    if (finalStatus) {
      this.host.showTransientStatus(finalStatus);
    }
    await this.hydrateOverview(snapshot, overview);
    requestRoomRushResultShare(snapshot);
  }

  private async hydrateOverview(
    runState: ActiveRoomRushRunState,
    overview: RoomRushResultOverview | null,
  ): Promise<void> {
    const focusCoordinates =
      overview?.focusCoordinates
      ?? this.prepareOverview(runState, { constrainCamera: false })?.focusCoordinates
      ?? null;
    if (!focusCoordinates) {
      return;
    }

    await this.waitForAnimationFrames(1);
    await this.refreshOverviewWindow(focusCoordinates);
    this.host.updateCameraBounds();
    this.prepareOverview(runState);
    this.host.flushPendingPreviewTextureBuilds();
    this.host.syncPreviewVisibility();
    this.host.updateBackdrop();
    this.host.redrawWorld();
    this.host.renderHud();
    await this.waitForAnimationFrames(2);
    this.host.flushPendingPreviewTextureBuilds();
    this.host.updateBackdrop();
    this.host.redrawWorld();
    this.host.renderHud();
  }

  private async refreshOverviewWindow(focusCoordinates: RoomCoordinates): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await this.host.refreshAround(focusCoordinates);
      if (result === 'success') {
        this.host.setWindowCenterCoordinates(focusCoordinates);
        this.host.syncPresenceSubscriptions();
        return true;
      }

      if (result === 'error') {
        return false;
      }

      await this.waitForDelay(100);
    }

    return false;
  }

  private prepareOverview(
    runState: ActiveRoomRushRunState,
    options: { constrainCamera?: boolean } = {},
  ): RoomRushResultOverview | null {
    if (this.host.getMode() !== 'browse') {
      return null;
    }

    const route = this.getRenderableRoute(runState);
    const xs = route.map((step) => step.coordinates.x);
    const ys = route.map((step) => step.coordinates.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerWorldX = ((minX + maxX + 1) / 2) * ROOM_PX_WIDTH;
    const centerWorldY = ((minY + maxY + 1) / 2) * ROOM_PX_HEIGHT;
    const focusCoordinates = {
      x: Math.round((minX + maxX) / 2),
      y: Math.round((minY + maxY) / 2),
    };
    const routeWidth = Math.max(3, maxX - minX + 1) * ROOM_PX_WIDTH;
    const routeHeight = Math.max(3, maxY - minY + 1) * ROOM_PX_HEIGHT;
    const fitZoom = Math.min(
      (this.scene.scale.width - 120) / routeWidth,
      (this.scene.scale.height - 120) / routeHeight,
    );
    const overviewZoom = Phaser.Math.Clamp(
      Math.min(0.115, fitZoom),
      this.settings.minZoom,
      this.settings.maxZoom,
    );

    this.host.applyOverviewCameraState({
      centerWorldX,
      centerWorldY,
      constrainCamera: options.constrainCamera !== false,
      focusCoordinates,
      overviewZoom,
    });
    return { focusCoordinates };
  }

  private getRenderableRoute(runState: ActiveRoomRushRunState): Array<{
    coordinates: RoomCoordinates;
  }> {
    return runState.route.length > 0
      ? runState.route
      : [{
          coordinates: { ...runState.startCoordinates },
        }];
  }

  private waitForAnimationFrames(frameCount: number): Promise<void> {
    return new Promise((resolve) => {
      let framesRemaining = Math.max(1, frameCount);
      const waitForFrame = () => {
        framesRemaining -= 1;
        if (framesRemaining <= 0) {
          resolve();
          return;
        }

        window.requestAnimationFrame(waitForFrame);
      };
      window.requestAnimationFrame(waitForFrame);
    });
  }

  private waitForDelay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }
}
