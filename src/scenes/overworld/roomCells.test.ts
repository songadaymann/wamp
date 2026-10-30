import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { OverworldRoomCellController } from './roomCells';

function createGraphics() {
  return {
    clear: vi.fn(),
    destroy: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: vi.fn(),
    setDepth: vi.fn(),
  };
}

describe('OverworldRoomCellController focus highlights', () => {
  it('moves current and selected highlights without redrawing cached room cells', () => {
    const graphics = [createGraphics(), createGraphics(), createGraphics()];
    let currentCoordinates = { x: 0, y: 0 };
    let selectedCoordinates = { x: 0, y: 0 };
    const controller = new OverworldRoomCellController({
      scene: {
        add: {
          graphics: vi.fn(() => graphics.shift()),
          text: vi.fn(() => {
            throw new Error('No frontier labels expected in this test.');
          }),
        },
      },
      getWorldWindow: () => ({ center: { x: 0, y: 0 }, radius: 1 }),
      getZoom: () => 1,
      getRoomOrigin: (coordinates: { x: number; y: number }) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      getCellStateAt: () => 'published',
      getRoomEditorCount: () => 0,
      getCurrentRoomCoordinates: () => currentCoordinates,
      getSelectedCoordinates: () => selectedCoordinates,
      getMode: () => 'play',
      isRoomInActiveCourse: () => false,
      getExpandedRoomIdAt: () => null,
    } as never);
    controller.create();
    const harness = controller as unknown as {
      roomFillGraphics: ReturnType<typeof createGraphics>;
      roomFrameGraphics: ReturnType<typeof createGraphics>;
      roomFocusGraphics: ReturnType<typeof createGraphics>;
    };

    controller.redraw();
    harness.roomFillGraphics.clear.mockClear();
    harness.roomFrameGraphics.clear.mockClear();
    harness.roomFocusGraphics.clear.mockClear();
    harness.roomFocusGraphics.fillRect.mockClear();
    currentCoordinates = { x: 1, y: 0 };
    selectedCoordinates = { x: 1, y: 0 };

    controller.redrawFocusHighlights();

    expect(harness.roomFillGraphics.clear).not.toHaveBeenCalled();
    expect(harness.roomFrameGraphics.clear).not.toHaveBeenCalled();
    expect(harness.roomFocusGraphics.clear).toHaveBeenCalledOnce();
    expect(harness.roomFocusGraphics.fillRect).toHaveBeenCalledWith(
      ROOM_PX_WIDTH + 4,
      4,
      ROOM_PX_WIDTH - 8,
      3,
    );
    expect(harness.roomFocusGraphics.fillRect).toHaveBeenCalledWith(
      ROOM_PX_WIDTH + 8,
      8,
      ROOM_PX_WIDTH - 16,
      2,
    );
  });
});

describe('Browse protection frames', () => {
  function setup({ minted = true, mode = 'browse', state = 'published', zoom = 1, expanded = false, editors = 0 } = {}) {
    const layers = [createGraphics(), createGraphics(), createGraphics()]; let next = 0;
    const options = { minted, mode, state, zoom, expanded, editors };
    const controller = new OverworldRoomCellController({
      scene: { add: { graphics: () => layers[next++], text: () => { throw new Error('No labels'); } } },
      getWorldWindow: () => ({ center: { x: 0, y: 0 }, radius: 0, rooms: [{ id: '0,0', isMinted: options.minted }] }),
      getZoom: () => options.zoom, getRoomOrigin: () => ({ x: 0, y: 0 }),
      getCellStateAt: () => options.state, getRoomEditorCount: () => options.editors,
      getCurrentRoomCoordinates: () => ({ x: 0, y: 0 }), getSelectedCoordinates: () => ({ x: 0, y: 0 }),
      getMode: () => options.mode, isRoomInActiveCourse: () => false,
      getExpandedRoomIdAt: () => options.expanded ? 'board' : null,
    } as never);
    controller.create(); controller.redraw(); return { controller, layers, options };
  }
  it.each([false, true])('shows only a protected published cell in Browse, including a cell inside an Expanded Room; expanded=%s', expanded => {
    const f = setup({ expanded });
    expect(f.layers[1].fillStyle).toHaveBeenCalledWith(0xf4cc55, 1);
    if (expanded) expect(f.layers[2].fillRect).not.toHaveBeenCalled();
    else expect(f.layers[2].fillRect).toHaveBeenCalled();
    f.layers[1].fillStyle.mockClear(); f.options.mode = 'play'; f.controller.redraw();
    expect(f.layers[1].fillStyle).not.toHaveBeenCalledWith(0xf4cc55, 1);
    f.options.mode = 'browse'; f.options.minted = false; f.controller.redraw();
    expect(f.layers[1].fillStyle).not.toHaveBeenCalledWith(0xf4cc55, 1);
    f.controller.destroy(); for (const layer of f.layers) expect(layer.destroy).toHaveBeenCalledOnce();
  });
  it('keeps private draft and claimed styling and preserves concurrent editor frames', () => {
    const draft = setup({ state: 'draft' }); expect(draft.layers[1].fillStyle).not.toHaveBeenCalledWith(0xf4cc55, 1);
    const claimed = setup({ state: 'claimed_unpublished' }); expect(claimed.layers[1].fillStyle).not.toHaveBeenCalledWith(0xf4cc55, 1);
    const edited = setup({ editors: 1 }); expect(edited.layers[1].fillStyle).toHaveBeenCalledWith(0xf4cc55, 1);
    expect(edited.layers[1].fillStyle.mock.calls.length).toBeGreaterThan(1);
  });
  it('updates frame thickness at zoom changes without adding scene objects on repeated redraw', () => {
    const f = setup(); f.layers[1].fillRect.mockClear();
    f.options.zoom = 0.5; f.controller.redrawForZoom();
    const calls = f.layers[1].fillRect.mock.calls.length; expect(calls).toBeGreaterThan(0);
    expect(f.layers[1].fillRect.mock.calls.some(call => call[3] === 4)).toBe(true);
    f.controller.redrawForZoom(); expect(f.layers[1].fillRect).toHaveBeenCalledTimes(calls);
  });
});
