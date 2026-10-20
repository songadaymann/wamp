import { describe, expect, it, vi } from 'vitest';
import { buildOverworldHudViewModel, type BuildOverworldHudViewModelOptions } from './hudViewModel';

vi.mock('../../worlds/clientContext', () => ({ canBuildInActiveWorld: () => false }));

function card(overrides: Partial<BuildOverworldHudViewModelOptions> = {}) {
  return buildOverworldHudViewModel({
    selectedState: 'published', selectedCoordinates: { x: 0, y: 0 },
    selectedSummary: { title: 'Room', creatorUserId: 'builder', creatorDisplayName: 'Builder' },
    selectedCreatorProfile: null, selectedOwnership: null, selectedDraft: null,
    selectedPublishedRoom: null, selectedPublishedCourse: null, selectedPopulation: 0,
    selectedEditorCount: 0, selectedEditorSummary: null, selectedCourse: null,
    selectedRoomInActiveCourseSession: false, frontierBuildBlocked: false, frontierClaimLimit: null,
    transientStatus: null, mode: 'browse', activeSignState: null, goalPersistentStatusText: null,
    rankingMode: null, roomTop: null, currentRoomLeaderboard: null, activeCourseRun: null,
    activeRoomRushRun: null, activeRoomGoalRun: null, activeGoalRoom: null, totalPlayerCount: 0,
    onlineRosterEntries: [], currentUserId: null, currentWalletAddress: null, score: 0,
    courseBuilderButtonDisabled: false, roomCommentsVisible: false, zoom: 1,
    getRoomDisplayTitle: title => title ?? 'Room', getExpandedRoomGoalBadgeText: () => 'Reach exit',
    getGoalBadgeText: () => '', getSelectedRoomGoalText: () => 'Reach exit',
    getExpandedRoomGoalTimerText: () => '', getPlayGoalTimerText: () => '',
    getExpandedRoomGoalProgressText: () => '', getPlayGoalProgressText: () => '',
    getRoomRushGoalBadgeText: () => '', getRoomRushTimerText: () => '', getRoomRushProgressText: () => '',
    truncateOverlayText: text => text, ...overrides,
  });
}

describe('room card available actions', () => {
  it('does not present an individual cell record as the Expanded Room record', () => {
    const record = { roomTop: { userDisplayName: 'Cell Runner', elapsedMs: 1000 } as never, rankingMode: 'time' as const };
    expect(card(record).leaderboardText).toBe('Best: Cell Runner · 1.00s');
    expect(card({ ...record, selectedCourse: { courseId: 'whole', courseTitle: 'Adventure', goalType: 'reach_exit', roomCount: 2 } }).leaderboardText).toBe('');
  });
  it('offers play and edit on a public room, without irrelevant build/expand actions', () => {
    expect(card()).toMatchObject({ playButtonHidden: false, editButtonHidden: false,
      buildButtonHidden: true, courseBuilderButtonHidden: true, selectedActionReasonText: '' });
  });
  it('offers only Build Here at the frontier and explains a daily claim limit', () => {
    expect(card({ selectedState: 'frontier' })).toMatchObject({ playButtonHidden: true,
      editButtonHidden: true, buildButtonHidden: false, leaderboardButtonHidden: true, commentButtonHidden: true });
    expect(card({ selectedState: 'frontier', frontierBuildBlocked: true, frontierClaimLimit: 3 }))
      .toMatchObject({ buildButtonHidden: true, selectedMetaText: 'Daily new-room claim limit reached (3/3)' });
  });
  it('keeps empty cells free of unusable controls with an adjacency explanation', () => {
    expect(card({ selectedState: 'empty' })).toMatchObject({ playButtonHidden: true,
      editButtonHidden: true, buildButtonHidden: true, courseBuilderButtonHidden: true,
      selectedMetaText: 'You can only build next to an existing published room' });
  });
  it('keeps claimed work playable while explaining who can edit it', () => {
    const selectedOwnership = { claimerUserId: 'builder', isMinted: false, mintedOwnerWalletAddress: null };
    expect(card({ selectedState: 'claimed_unpublished', selectedOwnership })).toMatchObject({
      playButtonHidden: false, editButtonHidden: true, selectedActionReasonText: 'Only the claimer can edit this unpublished room.' });
    expect(card({ selectedState: 'claimed_unpublished', selectedOwnership, currentUserId: 'builder' }))
      .toMatchObject({ editButtonHidden: false, selectedActionReasonText: '' });
  });
  it('offers local draft play/edit without public leaderboards or comments', () => {
    expect(card({ selectedState: 'draft' })).toMatchObject({ playButtonHidden: false,
      editButtonHidden: false, commentButtonHidden: true, leaderboardButtonHidden: true });
  });
  it('shows the minted edit restriction only to nonowners', () => {
    const selectedOwnership = { claimerUserId: 'builder', isMinted: true, mintedOwnerWalletAddress: '0xabc' };
    expect(card({ selectedOwnership })).toMatchObject({ editButtonHidden: true,
      selectedActionReasonText: 'Minted: only the token owner can edit.' });
    expect(card({ selectedOwnership, currentWalletAddress: '0xabc' }))
      .toMatchObject({ editButtonHidden: false, selectedActionReasonText: '' });
  });
  it('offers an explicit check to a linked buyer whose cached token owner differs', () => {
    expect(card({ selectedOwnership: { claimerUserId: 'builder', isMinted: true, mintedOwnerWalletAddress: '0xseller' },
      currentUserId: 'buyer', currentWalletAddress: '0xbuyer' })).toMatchObject({
      editButtonHidden: false, editButtonDisabled: false, editButtonText: 'Check ownership',
      courseBuilderButtonHidden: true, selectedActionReasonText: '',
    });
  });
  it('keeps the owner’s expanded setup available and labels expanded play', () => {
    expect(card({ currentUserId: 'builder', selectedCourse: {
      courseId: 'expanded:room', courseTitle: 'Adventure', goalType: 'reach_exit', roomCount: 2,
    } })).toMatchObject({ playButtonText: 'Play Expanded Room', editButtonText: 'Edit Expanded Room',
      courseBuilderButtonText: 'Expanded Room Setup', courseBuilderButtonHidden: false, selectedGoalText: 'Reach exit' });
  });
  it('labels an acquired minted cell Edit Room without exposing Expanded Setup', () => {
    expect(card({ currentUserId: 'buyer', currentWalletAddress: '0xbuyer',
      selectedOwnership: { claimerUserId: 'builder', isMinted: true, mintedOwnerWalletAddress: '0xbuyer' },
      selectedCourse: { courseId: 'expanded:room', courseTitle: 'Adventure', goalType: 'reach_exit', roomCount: 2 },
    })).toMatchObject({ editButtonText: 'Edit Room', courseBuilderButtonHidden: true });
  });
  it('keeps Stop and editor return available during play while hiding browse tools', () => {
    expect(card({ mode: 'play', selectedState: 'frontier' })).toMatchObject({ playButtonHidden: false,
      playButtonText: 'Stop', playButtonDisabled: false, editButtonHidden: true, buildButtonHidden: true });
    expect(card({ mode: 'play', editorPlaytest: true })).toMatchObject({ playButtonText: 'Back to Editor', playButtonHidden: false });
  });
  it('explains numbered World permissions without an unusable Edit control', () => {
    expect(card({ selectedSummary: { title: 'World', creatorUserId: 'builder', creatorDisplayName: 'Builder', world: { id: 'world', number: 1 } } }))
      .toMatchObject({ editButtonHidden: true, selectedActionReasonText: 'Only this World’s builders can edit here.' });
  });
});
