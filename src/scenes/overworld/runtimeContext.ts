import type Phaser from 'phaser';

export interface RuntimeCoordinates {
  x: number;
  y: number;
}

/** Narrow live views let controllers read scene-owned state without capturing it. */
export interface RuntimeModeReader<TMode extends string = string> {
  readonly mode: { readonly get: () => TMode };
}

export interface RuntimeRoomReader {
  readonly selectedCoordinates: RuntimeCoordinates;
  readonly currentRoomCoordinates: RuntimeCoordinates;
}

/** Raw references stay live across create/destroy/respawn. Interaction masking is separate. */
export interface RuntimePlayerReader {
  readonly player: Phaser.GameObjects.Rectangle | null;
  readonly playerBody: Phaser.Physics.Arcade.Body | null;
  readonly playerSprite: Phaser.GameObjects.Sprite | null;
  readonly playerPickupSensor: Phaser.GameObjects.Rectangle | null;
  readonly playerPickupSensorBody: Phaser.Physics.Arcade.Body | null;
}

export type OverworldRuntimeLifecycle = 'initializing' | 'active' | 'shutting-down';

export interface OverworldRuntimeContextSnapshot<TMode extends string, TCameraMode extends string> {
  lifecycle: OverworldRuntimeLifecycle;
  mode: TMode;
  cameraMode: TCameraMode;
  selectedCoordinates: RuntimeCoordinates;
  currentRoomCoordinates: RuntimeCoordinates;
  pvp: { arenaActive: boolean; matchActive: boolean };
  roomRush: { active: boolean };
  backdrop: { cameraActive: boolean; layerCount: number };
  lighting: { active: boolean };
}

interface OverworldRuntimeContextOptions<TMode extends string, TCameraMode extends string> {
  getPlayer: () => RuntimePlayerReader['player'];
  getPlayerBody: () => RuntimePlayerReader['playerBody'];
  getPlayerSprite: () => RuntimePlayerReader['playerSprite'];
  getPlayerPickupSensor: () => RuntimePlayerReader['playerPickupSensor'];
  getPlayerPickupSensorBody: () => RuntimePlayerReader['playerPickupSensorBody'];
  getMode: () => TMode;
  setMode: (mode: TMode) => void;
  getCameraMode: () => TCameraMode;
  setCameraMode: (mode: TCameraMode) => void;
  getSelectedCoordinates: () => RuntimeCoordinates;
  getCurrentRoomCoordinates: () => RuntimeCoordinates;
  isPvpArenaActive: () => boolean;
  isPvpMatchActive: () => boolean;
  isRoomRushActive: () => boolean;
  isBackdropCameraActive: () => boolean;
  getBackdropLayerCount: () => number;
  isLightingActive: () => boolean;
}

export class OverworldRuntimeContext<TMode extends string, TCameraMode extends string>
  implements RuntimeModeReader<TMode>, RuntimeRoomReader, RuntimePlayerReader {
  private lifecycle: OverworldRuntimeLifecycle = 'initializing';

  constructor(private readonly options: OverworldRuntimeContextOptions<TMode, TCameraMode>) {}

  readonly mode = {
    get: (): TMode => this.options.getMode(),
    set: (mode: TMode): void => this.options.setMode(mode),
  };

  readonly cameraMode = {
    get: (): TCameraMode => this.options.getCameraMode(),
    set: (mode: TCameraMode): void => this.options.setCameraMode(mode),
  };

  get player(): RuntimePlayerReader['player'] { return this.options.getPlayer(); }
  get playerBody(): RuntimePlayerReader['playerBody'] { return this.options.getPlayerBody(); }
  get playerSprite(): RuntimePlayerReader['playerSprite'] { return this.options.getPlayerSprite(); }
  get playerPickupSensor(): RuntimePlayerReader['playerPickupSensor'] { return this.options.getPlayerPickupSensor(); }
  get playerPickupSensorBody(): RuntimePlayerReader['playerPickupSensorBody'] { return this.options.getPlayerPickupSensorBody(); }
  get selectedCoordinates(): RuntimeCoordinates { return this.options.getSelectedCoordinates(); }
  get currentRoomCoordinates(): RuntimeCoordinates { return this.options.getCurrentRoomCoordinates(); }

  setLifecycle(lifecycle: OverworldRuntimeLifecycle): void {
    this.lifecycle = lifecycle;
  }

  getSnapshot(): OverworldRuntimeContextSnapshot<TMode, TCameraMode> {
    return {
      lifecycle: this.lifecycle,
      mode: this.options.getMode(),
      cameraMode: this.options.getCameraMode(),
      selectedCoordinates: { ...this.selectedCoordinates },
      currentRoomCoordinates: { ...this.currentRoomCoordinates },
      pvp: {
        arenaActive: this.options.isPvpArenaActive(),
        matchActive: this.options.isPvpMatchActive(),
      },
      roomRush: { active: this.options.isRoomRushActive() },
      backdrop: {
        cameraActive: this.options.isBackdropCameraActive(),
        layerCount: this.options.getBackdropLayerCount(),
      },
      lighting: { active: this.options.isLightingActive() },
    };
  }
}
