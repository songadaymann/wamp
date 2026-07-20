export interface RuntimeCoordinates {
  x: number;
  y: number;
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

export class OverworldRuntimeContext<TMode extends string, TCameraMode extends string> {
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

  setLifecycle(lifecycle: OverworldRuntimeLifecycle): void {
    this.lifecycle = lifecycle;
  }

  getSnapshot(): OverworldRuntimeContextSnapshot<TMode, TCameraMode> {
    return {
      lifecycle: this.lifecycle,
      mode: this.options.getMode(),
      cameraMode: this.options.getCameraMode(),
      selectedCoordinates: { ...this.options.getSelectedCoordinates() },
      currentRoomCoordinates: { ...this.options.getCurrentRoomCoordinates() },
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
