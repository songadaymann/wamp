import type { MobilePerformanceProfiler } from '../../debug/mobilePerformanceProfiler';
import { consumeTouchAction } from '../../ui/mobile/touchControls';
import type { OverworldCompositionPorts } from './composition/ports';
import type { RunFrameWorkResult } from './frameWorkCoordinator';

type FrameHost = Pick<OverworldCompositionPorts,
  | 'assist' | 'criticalFrameStartedAtMs' | 'mobilePerformanceProfiler'
  | 'mobilePerformanceControllerProfilingEnabled' | 'mobilePerformanceControllerProfileSlot'
  | 'windowController' | 'worldStreamingController' | 'updateBackdrop' | 'gridOverlayController'
  | 'mode' | 'physicsCadence' | 'liveObjectController' | 'getCollisionReadyLoadedFullRooms'
  | 'signController' | 'updateGhosts' | 'pvpInstanceRenderer' | 'combatPresentationController'
  | 'applyPvpArenaCameraLock' | 'roomChatController' | 'roomCommentsController'
  | 'presenceOverlayController' | 'roomMusicSyncInput' | 'currentRoomCoordinates'
  | 'activeCourseRun' | 'roomMusicPlaybackController' | 'isPvpMatchActive'
  | 'gameplayKeyboard' | 'gamepadInput' | 'toggleCameraMode'
  | 'stopCurrentPlay' | 'restartCurrentRun' | 'playerBody'
  | 'setLastMovementInput' | 'movementController' | 'syncLocalPresence'
  | 'syncPvpInstanceState' | 'syncPvpLocalHeartLabel' | 'updateRoomLighting'
  | 'updateRoomWeather' | 'renderFrameHud' | 'isPvpCountdownActive'
  | 'gameFeelController' | 'recordRankedRunTraceFrame' | 'objectiveController'
  | 'tickRoomRushRun' | 'updatePortalObjects' | 'combatController' | 'quicksandController'
  | 'maybeApplyRemotePvpActionHit' | 'maybeStompPvpPeer' | 'resolvePvpPeerCollision'
  | 'maybeRespawnFromVoid' | 'roomTransitionController' | 'cameraController'
  | 'updateMobilePortraitRoomFraming' | 'playerPresentationGroundedOverride'
  | 'playerPresentationController' | 'playerHealthController' | 'lostSongController'
  | 'ghostRaceController' | 'recordPerformanceAdvisorFrame' | 'buildMobilePerformanceContext'
>;

type Movement = ReturnType<NonNullable<FrameHost['physicsCadence']>['getMovement']>;
interface Frame {
  delta: number;
  gameplayDelta: number;
  criticalStartedAt: number;
  criticalUpdateMs: number | null;
  workResult: RunFrameWorkResult | null;
  tileBudgetConsumedMs: number;
  profiler: MobilePerformanceProfiler | null;
  profileSlot: number;
  countdownLocked: boolean;
  swordInputPressed: boolean;
  gunInputPressed: boolean;
  swordPressed: boolean;
  gunPressed: boolean;
  movement: Movement | null;
}
interface Stage {
  readonly id: string;
  readonly profile?: { readonly slot: number; readonly label: string };
  readonly run: (frame: Frame) => void;
}
interface Group {
  readonly label: string;
  readonly stages: readonly Stage[];
}
interface Phase {
  readonly id: string;
  /** True ends the current frame; finalizers still run. */
  readonly run: (frame: Frame) => boolean;
}

/** Slots 3 and 14 belong to the pre-update physics/environment work. */
export const OVERWORLD_CONTROLLER_PROFILE_SLOTS = 20;

/** Owns ordered frame stages, profiling boundaries and early-exit finalization. */
export class OverworldFramePipeline {
  private readonly world: Group;
  private readonly noPlayer: Group;
  private readonly player: Group;
  private readonly held: readonly Stage[];
  private readonly phases: readonly Phase[];
  private readonly frames: Frame[] = [];
  private depth = 0;

  constructor(private readonly host: FrameHost) {
    const profiled = (id: string, slot: number, label: string, run: Stage['run']): Stage =>
      ({ id, profile: { slot, label }, run });
    this.world = {
      label: 'update.world', stages: [
        profiled('streaming', 0, 'controller.worldStreaming', frame => {
          host.windowController.maybeRefreshVisibleChunks();
          const startedAt = performance.now();
          const ran = host.worldStreamingController.updateWorldTiles();
          frame.tileBudgetConsumedMs = ran ? performance.now() - startedAt : 0;
        }),
        profiled('backdrop', 1, 'controller.backdrop', () => host.updateBackdrop()),
        profiled('grid', 2, 'controller.gridOverlay', () => host.gridOverlayController.redraw()),
        {
          id: 'physics-presentation-handoff', run: () => {
            if (host.mode === 'play' && host.physicsCadence?.getStepsThisFrame() === 0) {
              host.liveObjectController.syncLiveObjectPresentation(host.getCollisionReadyLoadedFullRooms());
            }
          }
        },
        profiled('signs', 4, 'controller.signs', () => host.signController.update()),
        profiled('ghosts', 5, 'controller.ghosts', frame => host.updateGhosts(frame.delta)),
        profiled('pvp-presentation', 6, 'controller.pvpPresentation', frame => {
          host.pvpInstanceRenderer.update(frame.delta);
          host.combatPresentationController.update();
          host.applyPvpArenaCameraLock();
        }),
        profiled('chat', 7, 'controller.roomChat', () => host.roomChatController.update()),
        profiled('comments', 8, 'controller.roomComments', () => host.roomCommentsController.update()),
        profiled('browse-presence', 9, 'controller.presenceOverlay', frame => host.presenceOverlayController.updateBrowseDots(frame.delta)),
        profiled('music', 10, 'controller.roomMusic', () => {
          const input = host.roomMusicSyncInput;
          input.mode = host.mode;
          input.currentRoomCoordinates = host.currentRoomCoordinates;
          input.activeCourseRun = host.activeCourseRun;
          host.roomMusicPlaybackController.sync(input);
        }),
      ]
    };
    this.noPlayer = {
      label: 'update.noPlayer', stages: [
        profiled('missing-player-movement', 11, 'controller.movement', () => host.movementController.handleNoPlayerRuntime()),
        profiled('missing-player-presence', 12, 'controller.presencePvp', () => {
          host.syncLocalPresence();
          host.syncPvpInstanceState();
          host.syncPvpLocalHeartLabel();
        }),
        profiled('missing-player-environment', 13, 'controller.environment', () => {
          host.updateRoomLighting();
          host.updateRoomWeather();
        }),
      ]
    };
    this.held = [
      {
        id: 'buffer-held-combat', run: frame => host.gameFeelController.bufferCombatInput({
          swordPressed: frame.swordInputPressed, gunPressed: frame.gunInputPressed,
        })
      },
      { id: 'held-run-trace', run: frame => host.recordRankedRunTraceFrame(frame.gameplayDelta, host.physicsCadence!.getMovement()) },
      { id: 'held-objective', run: frame => host.objectiveController.update(frame.gameplayDelta, host.gameFeelController.isDeathPending()) },
      { id: 'held-room-rush', run: frame => host.tickRoomRushRun(frame.delta) },
      { id: 'held-hud', run: () => host.renderFrameHud() },
    ];
    this.player = {
      label: 'update.player', stages: [
        profiled('portals', 15, 'controller.portals', () => host.updatePortalObjects()),
        { id: 'movement-snapshot', run: frame => { frame.movement = host.physicsCadence!.getMovement(); } },
        profiled('combat', 16, 'controller.combat', frame => {
          const movement = frame.movement!;
          host.combatController.handleCombatInput({
            swordPressed: frame.swordPressed, gunPressed: frame.gunPressed,
            downHeld: movement.downHeld, grounded: movement.grounded,
          });
          host.quicksandController.updateVisualSink();
          host.combatController.updateSwordSwing();
          host.combatController.updateProjectiles(frame.gameplayDelta);
          host.maybeApplyRemotePvpActionHit();
          host.maybeStompPvpPeer();
          host.resolvePvpPeerCollision();
          host.movementController.syncLadderClimbSfx(movement.verticalInput);
          host.maybeRespawnFromVoid();
        }),
        profiled('room-transition', 17, 'controller.roomTransition', frame => {
          if (!host.gameFeelController.isDeathPending()) host.roomTransitionController.maybeAdvancePlayerRoom();
          host.cameraController.syncRoomCamera();
          host.cameraController.updateFollowPacing(host.physicsCadence!.getStepsThisFrame());
          host.updateMobilePortraitRoomFraming();
          host.recordRankedRunTraceFrame(frame.gameplayDelta, frame.movement!);
        }),
        profiled('player-presentation', 18, 'controller.playerPresentation', frame => {
          try {
            host.playerPresentationGroundedOverride = frame.movement!.grounded;
            if (!host.gameFeelController.isDeathPending()) host.playerPresentationController.syncPlayerVisual();
          } finally {
            host.playerPresentationGroundedOverride = null;
          }
        }),
        profiled('player-presence', 12, 'controller.presencePvp', () => {
          host.syncLocalPresence();
          host.syncPvpInstanceState();
          host.syncPvpLocalHeartLabel();
          host.playerHealthController.sync();
        }),
        profiled('player-environment', 13, 'controller.environment', () => {
          host.updateRoomLighting();
          host.updateRoomWeather();
        }),
        profiled('objectives', 19, 'controller.objectiveRoomRush', frame => {
          host.objectiveController.update(frame.gameplayDelta, host.gameFeelController.isDeathPending());
          host.tickRoomRushRun(frame.delta);
        }),
      ]
    };
    this.phases = [
      { id: 'world', run: frame => { this.runGroup(this.world, frame); return false; } },
      { id: 'commands', run: () => this.dispatchCommands() },
      { id: 'actor', run: frame => { this.updateActor(frame); return false; } },
    ];
  }

  update(delta: number): void {
    // Reuse frame storage; nested calls get independent locals just as Scene.update did.
    const index = this.depth++;
    const frame = this.frames[index] ?? (this.frames[index] = this.createFrame());
    try {
      frame.gameplayDelta = delta * (this.host.assist?.runtime.speed ?? 1);
      frame.delta = delta;
      frame.criticalStartedAt = this.host.criticalFrameStartedAtMs ?? performance.now();
      this.host.criticalFrameStartedAtMs = null;
      frame.criticalUpdateMs = null;
      frame.workResult = null;
      frame.tileBudgetConsumedMs = 0;
      frame.movement = null;
      frame.profiler = this.host.mobilePerformanceProfiler;
      frame.profileSlot = frame.profiler && this.host.mobilePerformanceControllerProfilingEnabled
        ? this.host.mobilePerformanceControllerProfileSlot : -1;
      if (frame.profileSlot >= 0) {
        this.host.mobilePerformanceControllerProfileSlot = (frame.profileSlot + 1) % OVERWORLD_CONTROLLER_PROFILE_SLOTS;
      }
      try {
        for (const phase of this.phases) if (phase.run(frame)) return;
      } finally {
        this.finalize(frame);
      }
    } finally {
      frame.movement = null;
      frame.profiler = null;
      frame.workResult = null;
      this.depth--;
    }
  }

  private runGroup(group: Group, frame: Frame): void {
    const startedAt = frame.profiler?.beginSegment();
    this.runStages(group.stages, frame);
    if (startedAt !== undefined) frame.profiler?.endSegment(group.label, startedAt);
  }

  private runStages(stages: readonly Stage[], frame: Frame): void {
    for (const stage of stages) {
      const startedAt = stage.profile && frame.profileSlot === stage.profile.slot
        ? frame.profiler?.beginSegment() : undefined;
      stage.run(frame);
      // Intentionally finish only after success, matching the existing profiler.
      if (startedAt !== undefined && stage.profile) frame.profiler?.endSegment(stage.profile.label, startedAt);
    }
  }

  private dispatchCommands(): boolean {
    const host = this.host;
    if (host.mode === 'play' && !host.isPvpMatchActive()
      && (host.gameplayKeyboard.pressed('camera') || consumeTouchAction('cameraToggle') || host.gamepadInput.pressed('camera'))) {
      host.toggleCameraMode();
    }
    if (host.mode === 'play' && (consumeTouchAction('stop') || host.gamepadInput.pressed('stop'))) {
      host.stopCurrentPlay();
      return true;
    }
    if (host.mode === 'play' && (consumeTouchAction('restart') || host.gamepadInput.pressed('restart'))) {
      void host.restartCurrentRun();
      return true;
    }
    return false;
  }

  private updateActor(frame: Frame): void {
    const host = this.host;
    if (!host.playerBody) {
      host.setLastMovementInput(0, 0);
      this.runGroup(this.noPlayer, frame);
      host.renderFrameHud();
      this.runDiscretionaryWork(frame);
      return;
    }
    frame.countdownLocked = host.isPvpCountdownActive();
    frame.swordInputPressed = host.gameplayKeyboard.pressed('slash') || consumeTouchAction('slash') || host.gamepadInput.pressed('slash');
    frame.gunInputPressed = host.gameplayKeyboard.pressed('shoot') || consumeTouchAction('shoot') || host.gamepadInput.pressed('shoot');
    if (host.gameFeelController.isHoldingPhysics()) {
      this.runStages(this.held, frame);
      return;
    }
    const input = host.gameFeelController.consumeCombatInput({
      swordPressed: frame.swordInputPressed, gunPressed: frame.gunInputPressed,
    });
    frame.swordPressed = !frame.countdownLocked && input.swordPressed;
    frame.gunPressed = !frame.countdownLocked && input.gunPressed;
    this.runGroup(this.player, frame);
    host.renderFrameHud();
    this.runDiscretionaryWork(frame);
  }

  private runDiscretionaryWork(frame: Frame): void {
    frame.criticalUpdateMs = Math.max(0, performance.now() - frame.criticalStartedAt - frame.tileBudgetConsumedMs);
    frame.workResult = this.host.worldStreamingController.runDiscretionaryFrameWork(
      performance.now() - frame.criticalStartedAt, frame.tileBudgetConsumedMs,
    );
  }

  private finalize(frame: Frame): void {
    const host = this.host;
    if (host.lostSongController.update()) host.liveObjectController.syncLostSongPresentation();
    host.ghostRaceController.update();
    host.recordPerformanceAdvisorFrame(
      frame.criticalUpdateMs ?? Math.max(0, performance.now() - frame.criticalStartedAt - frame.tileBudgetConsumedMs),
      frame.workResult,
    );
    frame.profiler?.endFrame(host.buildMobilePerformanceContext());
  }

  private createFrame(): Frame {
    return {
      delta: 0, gameplayDelta: 0, criticalStartedAt: 0, criticalUpdateMs: null, workResult: null,
      tileBudgetConsumedMs: 0, profiler: null, profileSlot: -1, countdownLocked: false,
      swordInputPressed: false, gunInputPressed: false, swordPressed: false, gunPressed: false, movement: null,
    };
  }
}
