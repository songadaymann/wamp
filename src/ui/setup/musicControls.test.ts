import { describe, expect, it, vi } from 'vitest';
import { setupRoomMusicControls } from './musicControls';
import { sceneCapabilityFixture } from './sceneCapabilityRegistry.testSupport';
import type { EditorMusicCommands } from './sceneBridge';

vi.mock('../keyboardFocus', () => ({ syncGameKeyboardFocus: vi.fn() }));

class Control extends EventTarget {
  value = '';
}

function harness(key: 'EditorScene' | 'CourseEditorScene') {
  const ids = ['btn-editor-music-mode', 'btn-editor-music-preview-toggle', 'btn-editor-music-save', 'btn-editor-music-publish', 'btn-editor-music-tempo-up', 'btn-editor-music-tempo-down', 'editor-music-phrase-save-name-input', 'editor-music-phrase-name-input'];
  const elements = new Map(ids.map(id => [id, new Control()]));
  const doc = Object.assign(new EventTarget(), { getElementById: (id: string) => elements.get(id) ?? null });
  const music = { toggleMusicMode: vi.fn(), toggleRoomMusicPreview: vi.fn(), saveRoomMusicDraftAndPhrases: vi.fn(), shiftRoomMusicTempo: vi.fn(), setRoomMusicPhraseNameSuffix: vi.fn(), setRoomMusicArrangementSlotCount: vi.fn(), selectArrangementSlot: vi.fn() };
  const publishRoom = vi.fn();
  const scene = sceneCapabilityFixture(key, { getMusicWorkflow: () => music as unknown as EditorMusicCommands, publishRoom });
  const game = { scene: { getScene: () => scene, isActive: (name: string) => name === key } };
  setupRoomMusicControls(game as never, doc as unknown as Document);
  return { elements, music, publishRoom, doc };
}

describe('music UI required coordinator connection', () => {
  it.each(['EditorScene', 'CourseEditorScene'] as const)('keeps mode, preview, save, tempo and publication buttons connected in %s', key => {
    const f = harness(key);
    for (const id of ['btn-editor-music-mode', 'btn-editor-music-preview-toggle', 'btn-editor-music-save', 'btn-editor-music-publish', 'btn-editor-music-tempo-up', 'btn-editor-music-tempo-down']) f.elements.get(id)!.dispatchEvent(new Event('click'));
    expect(f.music.toggleMusicMode).toHaveBeenCalledOnce();
    expect(f.music.toggleRoomMusicPreview).toHaveBeenCalledOnce();
    expect(f.music.saveRoomMusicDraftAndPhrases).toHaveBeenCalledOnce();
    expect(f.music.shiftRoomMusicTempo.mock.calls).toEqual([[5], [-5]]);
    expect(f.publishRoom).toHaveBeenCalledOnce();
    f.elements.get('editor-music-phrase-name-input')!.value = 'New name';
    f.elements.get('editor-music-phrase-name-input')!.dispatchEvent(new Event('input'));
    expect(f.music.setRoomMusicPhraseNameSuffix).toHaveBeenCalledWith('New name');
  });
  it('selects a slot inside a container with slot-count metadata without changing the arrangement size', () => {
    const f = harness('EditorScene');
    const container = { dataset: { roomMusicArrangementSlotCount: '8' } };
    const slot = {
      dataset: { roomMusicArrangementInstrument: 'drums', roomMusicArrangementSlot: '0' },
      closest(selector: string) {
        if (selector === '[data-room-music-arrangement-slot-count]') return container;
        if (selector === '[data-room-music-arrangement-slot]') return this;
        return null;
      },
    };
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: slot });
    f.doc.dispatchEvent(event);
    expect(f.music.selectArrangementSlot).toHaveBeenCalledWith('drums', 0);
    expect(f.music.setRoomMusicArrangementSlotCount).not.toHaveBeenCalled();
  });

});
