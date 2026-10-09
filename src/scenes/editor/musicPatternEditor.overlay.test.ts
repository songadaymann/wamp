import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) } } }));
import { EditorMusicPatternController } from './musicPatternEditor';
import { editorState } from '../../config';
import { createDefaultRoomPatternMusic, type RoomMusic, type RoomPatternMusic } from '../../music/model';

function graphics() {
  const stub = { visible: true } as Record<string, unknown>;
  for (const method of ['clear', 'fillStyle', 'fillRect', 'lineStyle', 'beginPath', 'moveTo', 'lineTo', 'strokePath', 'strokeRect',
    'fillRoundedRect', 'strokeRoundedRect', 'fillCircle', 'strokeCircle', 'setDepth', 'destroy']) {
    stub[method] = vi.fn(() => stub);
  }
  stub.setVisible = vi.fn((visible: boolean) => { stub.visible = visible; return stub; });
  return stub as { clear: ReturnType<typeof vi.fn>; visible: boolean };
}

function fixture() {
  let music: RoomMusic | null = createDefaultRoomPatternMusic();
  let preview: 'playing' | 'stopped' = 'stopped';
  let playhead = { audioCurrentTime: 0, transportStartTime: 1, patternStartTime: 1, loopDurationSec: 4, kind: 'pattern', swingPercent: 50, segmentCount: null, outputLatencySec: 0 };
  const layers: Array<ReturnType<typeof graphics>> = [];
  const text = () => {
    const label = { text: '', alpha: 1, style: { color: '' } } as Record<string, unknown>;
    for (const method of ['setOrigin', 'setDepth', 'setVisible', 'setPosition', 'setResolution', 'setText', 'setColor', 'setAlpha', 'setStyle', 'destroy']) {
      label[method] = vi.fn(() => label);
    }
    return label;
  };
  const scene = { add: { graphics: () => { const g = graphics(); layers.push(g); return g; }, text }, cameras: { main: { zoom: 1 } } };
  const controller = new EditorMusicPatternController(scene as never, {
    getRoomMusic: () => music,
    commitRoomMusic: (next: RoomMusic | null) => { music = next; return next; },
    replaceLegacyRoomMusicWithPattern: () => null,
    renderUi: vi.fn(),
    getMusicPlayheadInfo: () => playhead as never,
    getMusicPreviewState: () => preview,
    previewPatternCell: vi.fn(),
    getWorkspaceOrigin: () => ({ x: 0, y: 0 }),
  } as never);
  controller.create();
  const [backdrop, grid, cells, playheadLayer, mix] = layers;
  const clears = () => ({ backdrop: backdrop.clear.mock.calls.length, grid: grid.clear.mock.calls.length, cells: cells.clear.mock.calls.length,
    playhead: playheadLayer.clear.mock.calls.length, mix: mix.clear.mock.calls.length });
  return {
    controller, clears,
    pattern: () => music as RoomPatternMusic,
    setMusic: (next: RoomMusic | null) => { music = next; },
    play: (time: number) => { preview = 'playing'; playhead = { ...playhead, audioCurrentTime: time }; },
  };
}

const diff = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key]]));

describe('music overlay redraws only what changed', () => {
  it('draws once, then idles across frames', () => {
    const f = fixture();
    f.controller.updateOverlay(true);
    const first = f.clears();
    for (let frame = 0; frame < 30; frame += 1) f.controller.updateOverlay(true);
    expect(diff(f.clears(), first)).toEqual({ backdrop: 0, grid: 0, cells: 0, playhead: 0, mix: 0 });
  });

  it('redraws notes for a note edit, the mix panel for a volume change, and everything for a new lane', () => {
    const f = fixture();
    f.controller.updateOverlay(true);
    let before = f.clears();
    const edited = structuredClone(f.pattern()); edited.tabs.drums.snare = [4];
    f.setMusic(edited); f.controller.updateOverlay(true);
    expect(diff(f.clears(), before)).toEqual({ backdrop: 0, grid: 0, cells: 1, playhead: 0, mix: 0 });

    before = f.clears();
    const louder = structuredClone(edited); louder.mix.drums.volume = 0.4;
    f.setMusic(louder); f.controller.updateOverlay(true);
    expect(diff(f.clears(), before)).toEqual({ backdrop: 0, grid: 0, cells: 0, playhead: 0, mix: 1 });

    before = f.clears();
    f.controller.setActiveInstrumentTab('saw'); f.controller.updateOverlay(true);
    expect(diff(f.clears(), before)).toEqual({ backdrop: 1, grid: 1, cells: 1, playhead: 1, mix: 1 });

    before = f.clears();
    const keyed = structuredClone(louder); keyed.keyTonic = 'D';
    f.setMusic(keyed); f.controller.updateOverlay(true);
    expect(diff(f.clears(), before).cells).toBe(1);
  });

  it('relabels rows only when the lane or its pitch settings change', () => {
    const f = fixture();
    f.controller.setActiveInstrumentTab('saw');
    f.controller.updateOverlay(true);
    const labels = (f.controller as unknown as { rowLabels: Array<{ setPosition: ReturnType<typeof vi.fn> }> }).rowLabels;
    const positions = () => labels[0].setPosition.mock.calls.length;
    const before = positions();
    for (let frame = 0; frame < 10; frame += 1) f.controller.updateOverlay(true);
    expect(positions()).toBe(before);
    const shifted = structuredClone(f.pattern()); shifted.octaveShift.saw = 1;
    f.setMusic(shifted); f.controller.updateOverlay(true);
    expect(positions()).toBe(before + 1);
  });

  it('moves the playhead only when its step changes', () => {
    const f = fixture();
    f.controller.updateOverlay(true);
    f.play(1.01); f.controller.updateOverlay(true);
    const before = f.clears();
    f.play(1.05); f.controller.updateOverlay(true); // same step (0.125 s per step)
    expect(diff(f.clears(), before).playhead).toBe(0);
    f.play(1.2); f.controller.updateOverlay(true);
    expect(diff(f.clears(), before)).toEqual({ backdrop: 0, grid: 0, cells: 0, playhead: 1, mix: 0 });
  });

  it('redraws after the overlay is hidden and shown, and when the tileset theme changes', () => {
    const f = fixture();
    f.controller.updateOverlay(true);
    f.controller.updateOverlay(false);
    const hidden = f.clears();
    f.controller.updateOverlay(true);
    expect(diff(f.clears(), hidden)).toEqual({ backdrop: 1, grid: 1, cells: 1, playhead: 1, mix: 1 });

    const before = f.clears();
    const previous = editorState.selectedTilesetKey;
    editorState.selectedTilesetKey = `${previous}-other`;
    try {
      f.controller.updateOverlay(true);
    } finally {
      editorState.selectedTilesetKey = previous;
    }
    expect(diff(f.clears(), before)).toEqual({ backdrop: 1, grid: 1, cells: 1, playhead: 1, mix: 1 });
  });
});
