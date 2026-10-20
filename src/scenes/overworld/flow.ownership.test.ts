import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ensure: vi.fn(async () => {}), show: vi.fn(), hide: vi.fn(), error: vi.fn() }));
vi.mock('phaser', () => ({ default: { Math: { Clamp: (n: number) => n } } }));
vi.mock('../editorSceneLoader', () => ({ ensureEditorScenesRegistered: mocks.ensure }));
vi.mock('../../ui/appFeedback', () => ({ showBusyOverlay: mocks.show, hideBusyOverlay: mocks.hide, showBusyError: mocks.error }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: true }) }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({}) }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({}) }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
import { OverworldSceneFlowController } from './flow';
function harness(expanded = false) {
  const state = { current: true }, permit = { roomOnly: false, isCurrent: () => state.current, dispose: vi.fn() };
  const prepare = vi.fn(async () => permit), manager = { isSleeping: vi.fn(() => false), isPaused: vi.fn(() => false), isActive: vi.fn(() => false), run: vi.fn(), sleep: vi.fn(), stop: vi.fn() };
  const controller = new OverworldSceneFlowController({ game: {}, scene: manager } as never, {
    getSelectedCoordinates: () => ({ x: 0, y: 0 }), getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }),
    getCellStateAt: () => 'published', getSelectedPublishedCourseId: () => expanded ? 'expanded:one' : null,
    getSelectedRoomSnapshot: () => null, getActiveCourseEditContext: () => null, prepareRoomEdit: prepare,
  } as never);
  return { state, permit, prepare, manager, controller };
}
afterEach(() => { vi.clearAllMocks(); mocks.ensure.mockResolvedValue(); });
describe('ownership verification before either editor opens', () => {
  it.each([false, true])('deduplicates an Edit click and opens the intended editor (%s)', async expanded => {
    const f = harness(expanded); f.controller.editSelectedRoom(); f.controller.editSelectedRoom();
    await vi.waitFor(() => expect(f.manager.run).toHaveBeenCalledOnce());
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.manager.run.mock.calls[0][0]).toBe(expanded ? 'CourseEditorScene' : 'EditorScene');
    expect(f.permit.dispose).toHaveBeenCalledOnce();
  });
  it.each([false, true])('fences a selection/session change while the editor chunk loads (%s)', async expanded => {
    const f = harness(expanded); let done!: () => void;
    mocks.ensure.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
    f.controller.editSelectedRoom(); await vi.waitFor(() => expect(mocks.ensure).toHaveBeenCalledOnce());
    f.state.current = false; done(); await vi.waitFor(() => expect(f.permit.dispose).toHaveBeenCalledOnce());
    expect(f.manager.run).not.toHaveBeenCalled(); expect(f.manager.sleep).not.toHaveBeenCalled(); expect(mocks.hide).toHaveBeenCalled();
  });
  it('opens only the acquired cell and omits courseEdit even inside an Expanded Room', async () => {
    const f = harness(true); f.permit.roomOnly = true; f.controller.editSelectedRoom();
    await vi.waitFor(() => expect(f.manager.run).toHaveBeenCalledOnce());
    expect(f.manager.run).toHaveBeenCalledWith('EditorScene', expect.objectContaining({ roomCoordinates: { x: 0, y: 0 }, courseEdit: null }));
  });
  it('offers a new explicit retry after a failed ownership check', async () => {
    const f = harness(); f.prepare.mockRejectedValueOnce(new Error('Could not check room ownership. Please try again.'));
    f.controller.editSelectedRoom(); await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(f.manager.run).not.toHaveBeenCalled();
    const options = mocks.error.mock.calls[0][1] as { retryHandler: () => void }; options.retryHandler();
    await vi.waitFor(() => expect(f.manager.run).toHaveBeenCalledOnce()); expect(f.prepare).toHaveBeenCalledTimes(2);
  });
});
