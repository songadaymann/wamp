import { describe, expect, it, vi } from 'vitest';

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
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { createInspectInputController } from './overworld/composition/ui';
import { OverworldRoomRushModeController } from './overworld/roomRushMode';
import type { OverworldRoomRushRunController } from './overworld/roomRushRuns';

type Harness = Record<string, unknown> & {
  stopCurrentPlay(): void;
  playSelectedRoom(): void | Promise<void>;
};

function scene(fields: Record<string, unknown>): Harness {
  return Object.assign(Object.create(OverworldPlayScene.prototype), fields) as Harness;
}

const room = { ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), status: 'published' as const, version: 1 };

function rushHarness(mode: 'browse' | 'play' = 'play') {
  const showResult = vi.fn();
  const rush = new OverworldRoomRushModeController(
    { showTransientStatus: vi.fn(), renderHud: vi.fn() } as never,
    { showResult, reset: vi.fn() } as never,
  );
  (rush as unknown as { runController: OverworldRoomRushRunController }).runController.startRun({
    difficulty: 'hard', startRule: 'weekly', startCoordinates: room.coordinates,
    returnCoordinates: room.coordinates, startRoom: room,
  });
  const returnToWorld = vi.fn();
  return { harness: scene({ mode, roomRushModeController: rush, returnToWorld }), rush, showResult, returnToWorld };
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

describe('Escape after a composer lost focus (F385)', () => {
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
