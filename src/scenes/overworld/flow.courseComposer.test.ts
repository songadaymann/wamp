import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureEditorScenesRegistered,
  getActiveCourseDraftSessionRecord,
  getAuthDebugState,
} = vi.hoisted(() => ({
  ensureEditorScenesRegistered: vi.fn(async () => undefined),
  getActiveCourseDraftSessionRecord: vi.fn(() => null),
  getAuthDebugState: vi.fn(() => ({ authenticated: true })),
}));

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    },
  },
}));

vi.mock('../../auth/client', () => ({ getAuthDebugState }));
vi.mock('../../courses/draftSession', () => ({ getActiveCourseDraftSessionRecord }));
vi.mock('../editorSceneLoader', () => ({ ensureEditorScenesRegistered }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({}) }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({}) }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
vi.mock('../../navigation/worldNavigation', () => ({ setFocusedCoordinatesInUrl: vi.fn() }));

import { OverworldSceneFlowController } from './flow';

describe('active expanded-room composer flow', () => {
  beforeEach(() => {
    ensureEditorScenesRegistered.mockClear();
    getActiveCourseDraftSessionRecord.mockReset();
    getActiveCourseDraftSessionRecord.mockReturnValue(null);
    getAuthDebugState.mockReset();
    getAuthDebugState.mockReturnValue({ authenticated: true });
  });

  it('runs a new CourseComposerScene and sleeps the overworld', async () => {
    const { controller, game, host, sceneManager } = createHarness();

    await controller.openCourseComposer();

    expect(ensureEditorScenesRegistered).toHaveBeenCalledWith(game);
    expect(sceneManager.run).toHaveBeenCalledWith(
      'CourseComposerScene',
      expect.objectContaining({
        courseId: 'published-course',
        selectedCoordinates: { x: 4, y: 2 },
        centerCoordinates: { x: 3, y: 2 },
        statusMessage: null,
      }),
    );
    expect(sceneManager.sleep).toHaveBeenCalledOnce();
    expect(host.emitCourseComposerStateChanged).toHaveBeenCalledOnce();
    expect(host.renderHud).toHaveBeenCalledOnce();
  });

  it('wakes a sleeping CourseComposerScene and sleeps the overworld', async () => {
    const { controller, sceneManager } = createHarness({ sleeping: true });

    await controller.openCourseComposer();

    expect(sceneManager.wake).toHaveBeenCalledWith(
      'CourseComposerScene',
      expect.objectContaining({ courseId: 'published-course' }),
    );
    expect(sceneManager.run).not.toHaveBeenCalled();
    expect(sceneManager.sleep).toHaveBeenCalledOnce();
  });

  it('brings an active CourseComposerScene to the top and sleeps the overworld', async () => {
    const { controller, sceneManager } = createHarness({ active: true });

    await controller.openCourseComposer();

    expect(sceneManager.bringToTop).toHaveBeenCalledWith('CourseComposerScene');
    expect(sceneManager.wake).not.toHaveBeenCalled();
    expect(sceneManager.run).not.toHaveBeenCalled();
    expect(sceneManager.sleep).toHaveBeenCalledOnce();
  });
});

function createHarness(options: { sleeping?: boolean; paused?: boolean; active?: boolean } = {}) {
  const game = {};
  const sceneManager = {
    isSleeping: vi.fn(() => options.sleeping ?? false),
    isPaused: vi.fn(() => options.paused ?? false),
    isActive: vi.fn(() => options.active ?? false),
    wake: vi.fn(),
    sleep: vi.fn(),
    bringToTop: vi.fn(),
    run: vi.fn(),
  };
  const scene = {
    game,
    scene: sceneManager,
  };
  const host = {
    getSelectedCoordinates: vi.fn(() => ({ x: 4, y: 2 })),
    getCurrentRoomCoordinates: vi.fn(() => ({ x: 3, y: 2 })),
    getSelectedPublishedCourseId: vi.fn(() => 'published-course'),
    emitCourseComposerStateChanged: vi.fn(),
    renderHud: vi.fn(),
  };

  return {
    controller: new OverworldSceneFlowController(scene as never, host as never),
    game,
    host,
    sceneManager,
  };
}
