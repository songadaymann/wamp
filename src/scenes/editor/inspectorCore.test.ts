import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../roomVideo/editing', async () => ({
  getRoomVideo: (await import('../../roomVideo/uiState')).getRoomVideo,
  linkPressurePlateToRoomVideo: vi.fn(() => true),
}));
import { editorState, updateEditorState, type PlacedObject } from '../../config';
import { registerCustomSprite } from '../../customSprites/registry';
import { createDefaultRoomVideo } from '../../roomVideo/model';
import { ensureRoomVideoState } from '../../roomVideo/uiState';
import { linkPressurePlateToRoomVideo } from '../../roomVideo/editing';
import { EditorInspectorCore } from './inspectorCore';
import { EditorObjectLinkCopy } from './objectLinkCopy';

const saved = { selectedObjectId: editorState.selectedObjectId };
afterEach(() => { updateEditorState(saved); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function ref(id: string, objectId: string, x = 0) {
  const placed: PlacedObject = { id: objectId, instanceId: id, x: 8, y: 16 };
  const origin = { x, y: 0 };
  const runtime = {
    getPlacedObjectBounds: (p: PlacedObject) => ({ x: origin.x + p.x, y: p.y, width: 16, height: 16 }),
    toggleObjectPathTarget: vi.fn(() => 'added' as const), getObjectPathTargetIds: () => ['target'],
    setContainerContents: vi.fn(() => true),
  };
  return { placed, origin, runtime };
}

function fixture(objectId = 'floor_trigger') {
  const source = ref('source', objectId), target = ref('target', 'door_metal', 640);
  let connecting: typeof source | null = source;
  let hovered: typeof source | null = target;
  const clearCrossLink = vi.fn(), setLinkTarget = vi.fn(() => true), clearLink = vi.fn(() => true);
  const connectionChanged = vi.fn((r: typeof source, _status: string, keep: boolean) => { connecting = keep ? r : null; });
  const containerFocused = vi.fn(), render = vi.fn();
  const core = new EditorInspectorCore<typeof source>({
    placed: r => r.placed, runtime: r => r.runtime as never, origin: r => r.origin,
    connecting: () => connecting, findAt: (_world, predicate) => hovered && predicate(hovered) ? hovered : null,
    targets: () => [target], eligibleTargets: () => [target],
    setLinkTarget, clearLink, clearCrossLink, prune: vi.fn(), targetSummary: () => 'metal door in Cell B',
    connectionChanged, clearConnecting: () => { connecting = null; }, containerFocused, render,
    zoom: () => 1, copy: new EditorObjectLinkCopy(() => ({ scope: 'expanded room', videoAnchor: true })),
  });
  return { source, target, core, clearCrossLink, setLinkTarget, clearLink, connectionChanged,
    containerFocused, render, hover: (r: typeof source | null) => { hovered = r; } };
}

function graphics() {
  return { lineStyle: vi.fn(), strokeRoundedRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), strokePath: vi.fn(), fillStyle: vi.fn(), fillCircle: vi.fn() };
}

describe('shared inspector core', () => {
  it('replaces a stale cross-cell link when the source video is selected', () => {
    const f = fixture();
    ensureRoomVideoState(f.source.runtime).video = {
      ...createDefaultRoomVideo('abcdefghijk', 16 / 9), x: 32, y: 48, width: 160, trigger: true,
    };
    expect(f.core.clickConnection({ x: 80, y: 80 })).toBe(true);
    expect(linkPressurePlateToRoomVideo).toHaveBeenCalledExactlyOnceWith(f.source.runtime, 'source');
    expect(f.clearCrossLink).toHaveBeenCalledExactlyOnceWith(f.source);
    expect(f.setLinkTarget).not.toHaveBeenCalled();
    expect(f.connectionChanged).toHaveBeenCalledWith(f.source, 'Pressure plate linked to the video.', false);
  });

  it('keeps local moving-platform paths in their runtime and clears a previous course link', () => {
    const f = fixture('moving_platform');
    const anchor = ref('anchor', 'moving_platform_endpoint');
    anchor.runtime = f.source.runtime;
    f.hover(anchor);
    f.core.clickConnection({ x: 24, y: 16 });
    expect(f.source.runtime.toggleObjectPathTarget).toHaveBeenCalledWith('source', 'anchor');
    expect(f.clearCrossLink).toHaveBeenCalledWith(f.source);
    expect(f.setLinkTarget).not.toHaveBeenCalled();
    expect(f.connectionChanged).toHaveBeenCalledWith(f.source, expect.stringContaining('stop 1'), true);
  });

  it('gives a registered custom collectible accurate built-in-only container guidance', () => {
    const f = fixture(); const chest = ref('chest', 'treasure_chest', 640);
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
      getContext: () => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '', imageSmoothingEnabled: false }),
      toDataURL: () => 'data:image/png;base64,AA==',
    }) });
    registerCustomSprite({ id: 'inspector-gem', name: 'Custom Gem', kind: 'collectible', size: 16, status: 'active',
      pixels: Array(256).fill('#00ff00'), createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z' },
    { persist: false, notify: false });
    updateEditorState({ selectedObjectId: 'custom_sprite:inspector-gem' });
    f.hover(chest); expect(f.core.clickContainer({ x: 648, y: 16 })).toBe(true);
    expect(chest.runtime.setContainerContents).not.toHaveBeenCalled();
    expect(f.containerFocused).toHaveBeenLastCalledWith(chest, 'Custom sprites cannot go inside containers yet. Choose built-in contents.');
    const g = graphics(); f.core.drawContainerOverlay(g as never, chest);
    expect(g.lineStyle).toHaveBeenCalledWith(2, 0xffc76b, 0.74);
    expect(g.fillCircle).toHaveBeenCalledWith(648, 10, 3);
  });

  it('draws cross-cell links in world coordinates and offers only the source-cell video', () => {
    const f = fixture();
    for (const r of [f.source, f.target]) ensureRoomVideoState(r.runtime).video = {
      ...createDefaultRoomVideo('abcdefghijk', 16 / 9), x: 32, y: 48, width: 160, trigger: true,
    };
    const g = graphics(); f.core.drawPressureOverlay(g as never, f.source, { x: 720, y: 80 });
    expect(g.moveTo).toHaveBeenCalledWith(8, 12);
    expect(g.lineTo).toHaveBeenCalledWith(648, 10);
    expect(g.strokeRoundedRect).toHaveBeenCalledWith(32, 48, 160, 90, 6);
    expect(g.strokeRoundedRect).not.toHaveBeenCalledWith(672, 48, 160, 90, 6);
  });
});
