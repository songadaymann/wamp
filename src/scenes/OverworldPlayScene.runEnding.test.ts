import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));
vi.mock('../ui/modalState', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ui/modalState')>(),
  hasBlockingModalOpen: () => false,
}));

import { OverworldPlayScene } from './OverworldPlayScene';
import { createDefaultRoomMusic } from '../music/model';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { createInspectInputController } from './overworld/composition/ui';
import { OverworldSceneFlowController } from './overworld/flow';
import { OverworldRoomMusicPlaybackController } from './overworld/roomMusicPlaybackController';
import { OverworldRoomRushModeController } from './overworld/roomRushMode';
import type { OverworldRoomRushRunController } from './overworld/roomRushRuns';
import { OverworldSessionResetController } from './overworld/sessionReset';

type Harness = Record<string, unknown> & {
  stopCurrentPlay(): void;
  playSelectedRoom(): void | Promise<void>;
  jumpToCoordinates(coordinates: { x: number; y: number }): Promise<boolean>;
  handleSceneSleep(): void;
};

function scene(fields: Record<string, unknown>): Harness {
  return Object.assign(Object.create(OverworldPlayScene.prototype), fields) as Harness;
}

const room = { ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), status: 'published' as const, version: 1 };

function rushHarness(mode: 'browse' | 'play' = 'play', options: { difficulty?: 'easy' | 'hard'; deathPending?: boolean } = {}) {
  const showResult = vi.fn();
  const death = { pending: options.deathPending ?? false };
  const rush = new OverworldRoomRushModeController(
    { showTransientStatus: vi.fn(), renderHud: vi.fn(), isDeathPending: () => death.pending } as never,
    { showResult, reset: vi.fn() } as never,
  );
  const difficulty = options.difficulty ?? 'hard';
  (rush as unknown as { runController: OverworldRoomRushRunController }).runController.startRun({
    difficulty, startRule: difficulty === 'hard' ? 'weekly' : 'selected', startCoordinates: room.coordinates,
    returnCoordinates: room.coordinates, startRoom: room,
  });
  const returnToWorld = vi.fn();
  const showTransientStatus = vi.fn();
  const selectionController = { jumpToCoordinates: vi.fn(async () => {}) };
  const harness = scene({ mode, roomRushModeController: rush, returnToWorld, showTransientStatus, selectionController });
  return { harness, rush, death, showResult, returnToWorld, showTransientStatus, selectionController };
}

describe('one stop path for every input (F378)', () => {
  it('ends an active Room Rush through its result instead of abandoning it', () => {
    const h = rushHarness();
    h.harness.stopCurrentPlay();
    expect(h.showResult).toHaveBeenCalledOnce();
    expect(h.showResult.mock.calls[0][0]).toMatchObject({ result: 'completed', startRule: 'weekly' });
    // The result dialog returns to the world itself; a direct return would abandon the run first.
    expect(h.returnToWorld).not.toHaveBeenCalled();
  });

  it('routes the HUD Play/Stop button through the same path', () => {
    const h = rushHarness();
    void h.harness.playSelectedRoom();
    expect(h.showResult.mock.calls[0][0]).toMatchObject({ result: 'completed' });
  });

  it('returns to the world without a Rush, and does nothing outside play', () => {
    const play = scene({ mode: 'play', roomRushModeController: { getCurrentRun: () => null }, returnToWorld: vi.fn() });
    play.stopCurrentPlay();
    expect(play.returnToWorld).toHaveBeenCalledOnce();
    const browse = rushHarness('browse');
    browse.harness.stopCurrentPlay();
    expect(browse.showResult).not.toHaveBeenCalled();
    expect(browse.returnToWorld).not.toHaveBeenCalled();
  });
});

describe('a stop during the death beat of a Rush a death would fail', () => {
  it('lets the death fail the Weekly Rush instead of saving it as completed', () => {
    const h = rushHarness('play', { deathPending: true });
    h.harness.stopCurrentPlay();
    expect(h.showResult).not.toHaveBeenCalled();
    expect(h.rush.getCurrentRun()).toMatchObject({ result: 'active', deaths: 0 });
    // The beat ends and records the death, which fails the run with its result.
    h.death.pending = false;
    h.rush.recordDeath('Ouch.');
    expect(h.showResult).toHaveBeenCalledOnce();
    expect(h.showResult.mock.calls[0][0]).toMatchObject({ result: 'failed', deaths: 1 });
  });

  it('applies to a jump as well, which still gives way to the coming result', async () => {
    const h = rushHarness('play', { deathPending: true });
    await expect(h.harness.jumpToCoordinates({ x: 9, y: 4 })).resolves.toBe(false);
    expect(h.selectionController.jumpToCoordinates).not.toHaveBeenCalled();
    expect(h.showResult).not.toHaveBeenCalled();
    expect(h.rush.getCurrentRun()?.result).toBe('active');
  });

  it('still stops an Easy Rush at once, since its deaths do not end the run', () => {
    const h = rushHarness('play', { difficulty: 'easy', deathPending: true });
    h.harness.stopCurrentPlay();
    expect(h.showResult.mock.calls[0][0]).toMatchObject({ result: 'completed', difficulty: 'easy' });
  });
});

describe('Escape after a composer lost focus (F385)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  function composerHarness(open: { comments: boolean; chat: boolean }) {
    const keys = new Map<string, (event: unknown) => void>();
    const stopCurrentPlay = vi.fn();
    const comments = vi.fn(() => { const was = open.comments; open.comments = false; return was; });
    const chat = vi.fn(() => { const was = open.chat; open.chat = false; return was; });
    createInspectInputController({
      scene: {
        input: { keyboard: { on: (name: string, fn: (event: unknown) => void) => keys.set(name, fn) }, on: vi.fn() },
        game: { events: { on: vi.fn() } },
      },
      mode: 'play',
      roomCommentsController: { handleEscapeKey: comments },
      roomChatController: { handleEscapeKey: chat },
      stopCurrentPlay,
    } as never).initialize();
    vi.stubGlobal('document', { getElementById: () => null });
    const escape = () => keys.get('keydown-ESC')!({ repeat: false, ctrlKey: false, metaKey: false, altKey: false });
    return { escape, stopCurrentPlay, comments, chat };
  }

  it('closes the chat composer without also leaving the room', () => {
    const h = composerHarness({ comments: false, chat: true });
    h.escape();
    expect(h.chat).toHaveBeenCalledOnce();
    expect(h.stopCurrentPlay).not.toHaveBeenCalled();
    h.escape();
    expect(h.stopCurrentPlay).toHaveBeenCalledOnce();
  });

  it('closes the comment composer before the chat and still keeps the run', () => {
    const h = composerHarness({ comments: true, chat: true });
    h.escape();
    expect(h.comments).toHaveBeenCalledOnce();
    expect(h.chat).not.toHaveBeenCalled();
    h.escape();
    expect(h.stopCurrentPlay).not.toHaveBeenCalled();
  });
});

describe('jumping to a room mid-run (F383)', () => {
  function jumpHarness(options: { rush?: boolean; mode?: 'browse' | 'play' } = {}) {
    const order: string[] = [];
    const state: Record<string, unknown> = {
      activeCourseRun: { result: 'active', course: { roomRefs: [] } },
      editorPlaytestReturnTarget: { roomCoordinates: { x: 3, y: 1 } },
      courseEditorReturnTarget: { courseId: 'course-1' },
    };
    const finalizeActiveCourseRun = vi.fn();
    const clearActiveCourseRoomOverrides = vi.fn();
    const abandonGoalRun = vi.fn();
    const sessionReset = new OverworldSessionResetController({
      getActiveCourseRun: () => state.activeCourseRun,
      getActiveRoomRushRun: () => null,
      getCurrentGoalRun: () => null,
      abandonGoalRun, abandonRoomRushRun: vi.fn(), finalizeActiveCourseRun,
      setActiveCourseRun: (run: unknown) => { state.activeCourseRun = run; },
      clearActiveCourseRoomOverrides,
      resetTransientPlayState: vi.fn(), resetGoalRunController: vi.fn(),
      resetRoomRushController: vi.fn(), redrawGoalMarkers: vi.fn(),
    } as never);
    const scenes = { wake: vi.fn(), sleep: vi.fn(), run: vi.fn(), bringToTop: vi.fn(), isSleeping: () => true, isPaused: () => false, isActive: () => false };
    const flow = new OverworldSceneFlowController({ scene: scenes } as never, {
      setCourseEditorReturnTarget: (target: unknown) => { state.courseEditorReturnTarget = target; },
      setEditorPlaytestReturnTarget: (target: unknown) => { state.editorPlaytestReturnTarget = target; },
      resetPlaySession: () => { order.push('reset'); sessionReset.resetPlaySession(); },
      clearTouchGestureState: vi.fn(),
    } as never);
    const endRush = vi.fn();
    const clearActiveMatch = vi.fn(() => order.push('pvp'));
    const jump = vi.fn(async () => { order.push('jump'); });
    const showTransientStatus = vi.fn();
    const harness = scene({
      mode: options.mode ?? 'play',
      showTransientStatus,
      flowController: flow,
      pvpArenaController: { clearActiveMatch },
      roomRushModeController: { getCurrentRun: () => options.rush ? { result: 'active' } : null, end: endRush },
      selectionController: { jumpToCoordinates: jump },
    });
    return { harness, state, order, scenes, finalizeActiveCourseRun, clearActiveCourseRoomOverrides, abandonGoalRun, clearActiveMatch, endRush, jump, showTransientStatus };
  }

  it('ends the Expanded Room run, its overrides and the duel before moving, like Stop', async () => {
    const h = jumpHarness();
    await expect(h.harness.jumpToCoordinates({ x: 9, y: 4 })).resolves.toBe(true);
    expect(h.state.activeCourseRun).toBeNull();
    expect(h.finalizeActiveCourseRun).toHaveBeenCalledWith('abandoned');
    expect(h.clearActiveCourseRoomOverrides).toHaveBeenCalled();
    expect(h.abandonGoalRun).toHaveBeenCalled();
    expect(h.clearActiveMatch).toHaveBeenCalledWith(true);
    expect(h.order).toEqual(['pvp', 'reset', 'jump']);
    expect(h.jump).toHaveBeenCalledWith({ x: 9, y: 4 });
  });

  it('forgets an editor test run without waking the editor', async () => {
    const h = jumpHarness();
    await h.harness.jumpToCoordinates({ x: 9, y: 4 });
    expect(h.state.editorPlaytestReturnTarget).toBeNull();
    expect(h.state.courseEditorReturnTarget).toBeNull();
    expect(h.scenes.wake).not.toHaveBeenCalled();
    expect(h.scenes.run).not.toHaveBeenCalled();
    expect(h.scenes.sleep).not.toHaveBeenCalled();
  });

  it('ends a Room Rush through its result, which takes the place of the jump, and says so', async () => {
    const h = jumpHarness({ rush: true });
    await expect(h.harness.jumpToCoordinates({ x: 9, y: 4 })).resolves.toBe(false);
    expect(h.endRush).toHaveBeenCalledOnce();
    expect(h.order).toEqual([]);
    expect(h.jump).not.toHaveBeenCalled();
    expect(h.showTransientStatus).toHaveBeenCalledWith('Room Rush ended. Open the room again to play it.');
  });

  it('jumps straight from browse without touching a session', async () => {
    const h = jumpHarness({ mode: 'browse' });
    await h.harness.jumpToCoordinates({ x: 9, y: 4 });
    expect(h.order).toEqual(['jump']);
    expect(h.state.activeCourseRun).not.toBeNull();
  });
});

describe('room music after a test run returns to the editor (F375)', () => {
  it('stops the loop at scene sleep and plays it again on the next test', () => {
    const music = createDefaultRoomMusic();
    music.arrangement.laneAssignments.drums[0] = 'clip-a';
    const testRoom = { ...room, music };
    const playArrangement = vi.fn();
    const stopArrangement = vi.fn();
    const controller = new OverworldRoomMusicPlaybackController({
      getRoomSnapshotViewForCoordinates: () => testRoom,
      getRoomSummaryById: () => null,
      getRoomSummaries: () => [],
      getRoomSummariesRevision: () => 0,
      getExpandedRoomIdAt: () => null,
      getCourseStartRoomRef: () => null,
    }, { playArrangement, stopArrangement });
    const harness = scene({
      roomMusicPlaybackController: controller,
      resetPerformanceAdvisorEvidence: vi.fn(),
      syncPerformanceAdvisorEligibility: vi.fn(),
    });
    const input = { mode: 'play' as const, currentRoomCoordinates: testRoom.coordinates, activeCourseRun: null };

    controller.sync(input);
    expect(playArrangement).toHaveBeenCalledOnce();
    // Stop from a DOM button switches to browse and sleeps the scene before another frame runs.
    harness.handleSceneSleep();
    expect(stopArrangement).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'idle', resetTransport: true }));
    expect(harness.performanceAdvisorSceneActive).toBe(false);

    controller.sync(input);
    expect(playArrangement).toHaveBeenCalledTimes(2);
  });
});
