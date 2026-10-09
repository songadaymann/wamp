import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorMusicWorkflowCoordinator } from './musicWorkflow';
import { globalRoomMusicController } from '../../music/controller';
import { extractMusicPhrasePayloadFromPattern, type MusicPhraseRecord } from '../../music/library';
import {
  createDefaultRoomPatternMusic,
  createDefaultRoomPhraseArrangementMusic,
  type RoomMusic,
  type RoomPatternInstrumentId,
} from '../../music/model';
import { buildMusicPhraseAudition } from '../../music/phraseAudition';
import { syncMusicArrangementPlayhead } from './musicUi';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
vi.mock('./musicUi', () => ({
  renderMusicArrangementPanel: vi.fn(),
  renderMusicLibraryPanel: vi.fn(),
  renderMusicWorkbenchModeButtons: vi.fn(),
  syncMusicArrangementPlayhead: vi.fn(),
}));
vi.mock('../../music/controller', () => ({
  globalRoomMusicController: {
    playArrangement: vi.fn().mockResolvedValue(undefined),
    stopArrangement: vi.fn(),
    previewSequence: vi.fn(),
    stopPreviewClip: vi.fn(),
    getPreviewClipId: vi.fn(),
    getPlayheadInfo: vi.fn(),
  },
}));

const controller = vi.mocked(globalRoomMusicController);

function phrase(id: string, instrumentId: RoomPatternInstrumentId = 'saw'): MusicPhraseRecord {
  const source = createDefaultRoomPatternMusic();
  source.bpm = 90;
  if (instrumentId === 'drums') source.tabs.drums.snare = [4];
  else source.tabs[instrumentId].steps[0] = 2;
  const payload = extractMusicPhrasePayloadFromPattern(source, instrumentId);
  if (!payload) throw new Error('payload');
  return {
    id, batchId: 'batch', roomId: 'room', roomVersion: 1, roomTitle: null, roomX: 0, roomY: 0,
    creatorUserId: null, creatorPrincipalKind: null, creatorAgentId: null, creatorDisplayName: 'Builder',
    instrumentId, ordinal: 1, label: id, fingerprint: `fp-${id}`, payload,
    sourceKeyTonic: null, sourceKeyMode: null, sourcePhraseIds: [], createdAt: '2026-10-09T00:00:00.000Z',
  };
}

function harness(music: RoomMusic | null = { ...createDefaultRoomPatternMusic(), bpm: 140 }) {
  let roomMusic = music;
  let activeTab: RoomPatternInstrumentId = 'saw';
  const requestRender = vi.fn();
  const patternController = {
    getActiveInstrumentTab: () => activeTab,
    setActiveInstrumentTab: vi.fn((next: RoomPatternInstrumentId) => { activeTab = next; }),
    isPatternWorkspaceEmpty: vi.fn(() => false),
    insertPhrase: vi.fn(),
    cancelPastePreview: vi.fn(),
  };
  const workflow = new EditorMusicWorkflowCoordinator({
    commitRoomMusic: (next: RoomMusic | null) => { roomMusic = next; return next; },
    getRoomMusic: () => roomMusic,
    requestRender,
    replaceLegacyRoomMusicWithPattern: () => roomMusic,
  } as never);
  workflow.attachPatternController(patternController as never);
  const internals = workflow as unknown as {
    musicPreviewState: string;
    musicModeActive: boolean;
    musicComposerMode: string;
    musicPhraseOrchestrator: { libraryItems: MusicPhraseRecord[]; loadPhrase: (id: string) => Promise<MusicPhraseRecord> };
  };
  internals.musicPhraseOrchestrator.libraryItems = [phrase('a'), phrase('b')];
  return { workflow, internals, patternController, requestRender };
}

beforeEach(() => {
  vi.clearAllMocks();
  controller.previewSequence.mockResolvedValue(true);
  controller.getPreviewClipId.mockReturnValue(null);
});

describe('library phrase audition in the editor', () => {
  it('loops the phrase in the room tempo without committing, and a second tap stops it', async () => {
    const { workflow, patternController, requestRender } = harness();
    await workflow.toggleMusicPhraseAudition('a');

    const expected = buildMusicPhraseAudition(phrase('a'), { ...createDefaultRoomPatternMusic(), bpm: 140 }, { adoptPhraseTiming: false, adoptPhraseKey: false });
    expect(controller.previewSequence).toHaveBeenCalledExactlyOnceWith(expected.key, expected.sequence);
    expect(expected.sequence.bpm).toBe(140);
    expect(workflow.getAuditionPhraseId()).toBe('a');
    expect(patternController.insertPhrase).not.toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalled();

    await workflow.toggleMusicPhraseAudition('a');
    expect(controller.stopPreviewClip).toHaveBeenCalledOnce();
    expect(workflow.getAuditionPhraseId()).toBeNull();
  });

  it('uses the phrase tempo when placing it would adopt it', async () => {
    const { workflow, patternController } = harness();
    patternController.isPatternWorkspaceEmpty.mockReturnValue(true);
    await workflow.toggleMusicPhraseAudition('a');
    expect(controller.previewSequence.mock.calls[0][1].bpm).toBe(90);
  });

  it('stops the room preview so the audition plays alone', async () => {
    const { workflow, internals } = harness();
    internals.musicPreviewState = 'playing';
    await workflow.toggleMusicPhraseAudition('a');
    expect(workflow.getPreviewState()).toBe('stopped');
    expect(controller.stopArrangement).toHaveBeenCalledWith(expect.objectContaining({ mode: 'editor-preview' }));
  });

  it('keeps only the newest tap when a slower load resolves late', async () => {
    const { workflow, internals } = harness();
    let finishSlow!: (value: MusicPhraseRecord) => void;
    internals.musicPhraseOrchestrator.loadPhrase = () => new Promise((resolve) => { finishSlow = resolve; });
    const slow = workflow.toggleMusicPhraseAudition('not-listed');
    await workflow.toggleMusicPhraseAudition('b');
    finishSlow(phrase('not-listed'));
    await slow;
    expect(controller.previewSequence).toHaveBeenCalledOnce();
    expect(controller.previewSequence.mock.calls[0][0]).toContain('b|');
    expect(workflow.getAuditionPhraseId()).toBe('b');
  });

  it('explains a silent audition when music is muted', async () => {
    const { workflow } = harness();
    controller.previewSequence.mockResolvedValue(false);
    await workflow.toggleMusicPhraseAudition('a');
    expect(workflow.getAuditionPhraseId()).toBeNull();
    expect((workflow as unknown as { auditionNotice: string | null }).auditionNotice).toMatch(/Music volume is off/);
  });

  it('stops when the phrase is placed or the library switches instrument, not for same-lane slots', async () => {
    const { workflow, internals } = harness();
    internals.musicPhraseOrchestrator.loadPhrase = async (id) => phrase(id);
    await workflow.toggleMusicPhraseAudition('a');
    await workflow.useMusicPhrase('a');
    expect(workflow.getAuditionPhraseId()).toBeNull();
    expect(controller.stopPreviewClip).toHaveBeenCalledOnce();

    await workflow.toggleMusicPhraseAudition('b');
    workflow.setMusicPatternInstrumentTab('saw');
    expect(workflow.getAuditionPhraseId()).toBe('b');
    workflow.setMusicPatternInstrumentTab('square');
    expect(workflow.getAuditionPhraseId()).toBeNull();
    expect(controller.stopPreviewClip).toHaveBeenCalledTimes(2);
  });

  it('notices an audition stopped elsewhere, such as muting music', async () => {
    const { workflow, requestRender } = harness();
    await workflow.toggleMusicPhraseAudition('a');
    controller.getPreviewClipId.mockReturnValue(controller.previewSequence.mock.calls[0][0]);
    workflow.updatePlaybackIndicators();
    expect(workflow.getAuditionPhraseId()).toBe('a');

    requestRender.mockClear();
    controller.getPreviewClipId.mockReturnValue(null);
    workflow.updatePlaybackIndicators();
    expect(workflow.getAuditionPhraseId()).toBeNull();
    expect(requestRender).toHaveBeenCalledOnce();
  });
});

describe('Arrange playhead', () => {
  it('highlights the playing slot only while previewing in Arrange, updating the DOM on change', () => {
    const arrangement = createDefaultRoomPhraseArrangementMusic();
    const { workflow, internals } = harness(arrangement);
    internals.musicModeActive = true;
    internals.musicComposerMode = 'arrangement';
    internals.musicPreviewState = 'playing';
    const info = { audioCurrentTime: 14.5, transportStartTime: 10, patternStartTime: 10, loopDurationSec: 12, kind: 'phraseArrangement' as const, swingPercent: 50, segmentCount: 3, outputLatencySec: 0 };
    controller.getPlayheadInfo.mockReturnValue(info);

    workflow.updatePlaybackIndicators();
    workflow.updatePlaybackIndicators();
    expect(syncMusicArrangementPlayhead).toHaveBeenCalledExactlyOnceWith(1);

    controller.getPlayheadInfo.mockReturnValue({ ...info, audioCurrentTime: 19 });
    workflow.updatePlaybackIndicators();
    expect(syncMusicArrangementPlayhead).toHaveBeenLastCalledWith(2);

    internals.musicComposerMode = 'sequencer';
    workflow.updatePlaybackIndicators();
    expect(syncMusicArrangementPlayhead).toHaveBeenLastCalledWith(null);

    internals.musicComposerMode = 'arrangement';
    controller.getPlayheadInfo.mockReturnValue({ ...info, kind: 'pattern', segmentCount: null });
    workflow.updatePlaybackIndicators();
    expect(syncMusicArrangementPlayhead).toHaveBeenCalledTimes(3);
  });
});
