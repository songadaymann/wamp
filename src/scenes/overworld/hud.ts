import type { RoomCoordinates } from '../../persistence/roomModel';
import {
  MULTIPLAYER_MODE_LIST,
  getMultiplayerModeDefinition,
  type MultiplayerModeId,
} from '../../multiplayer/model';
import { isOpenableProfileUserId, requestProfileOpen } from '../../ui/setup/profileEvents';

interface OverworldHudRuntimeConfig {
  onPlayRoom: () => void | Promise<void>;
  onRestartRun: () => void | Promise<void>;
  onPlayCourse: () => void | Promise<void>;
  onEditRoom: () => void | Promise<void>;
  onBuildRoom: () => void | Promise<void>;
  onOpenCourseBuilder: () => void | Promise<void>;
  onJumpToCoordinates: (coordinates: RoomCoordinates) => void | Promise<void>;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpenExplore: () => void | Promise<void>;
  onOpenLeaderboard: () => void | Promise<void>;
  onOpenRoomRush: () => void | Promise<void>;
  onOpenRoomComment: () => void | Promise<void>;
  onToggleRoomComments: () => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
  onOpenMultiplayer: () => boolean | Promise<boolean>;
  onInviteMultiplayer: (
    modeId: MultiplayerModeId,
    entry: OverworldOnlineRosterViewEntry,
  ) => void | Promise<void>;
  onOpenControls: () => void | Promise<void>;
  onFitWorld: () => void;
}

const runtimeConfig: OverworldHudRuntimeConfig = {
  onPlayRoom: () => {},
  onRestartRun: () => {},
  onPlayCourse: () => {},
  onEditRoom: () => {},
  onBuildRoom: () => {},
  onOpenCourseBuilder: () => {},
  onJumpToCoordinates: () => {},
  onZoomIn: () => {},
  onZoomOut: () => {},
  onOpenExplore: () => {},
  onOpenLeaderboard: () => {},
  onOpenRoomRush: () => {},
  onOpenRoomComment: () => {},
  onToggleRoomComments: () => {},
  onOpenSettings: () => {},
  onOpenMultiplayer: () => true,
  onInviteMultiplayer: () => {},
  onOpenControls: () => {},
  onFitWorld: () => {},
};

export function configureOverworldHudBridgeRuntime(
  config: Partial<OverworldHudRuntimeConfig>,
): void {
  if (config.onPlayRoom) {
    runtimeConfig.onPlayRoom = config.onPlayRoom;
  }
  if (config.onRestartRun) {
    runtimeConfig.onRestartRun = config.onRestartRun;
  }
  if (config.onPlayCourse) {
    runtimeConfig.onPlayCourse = config.onPlayCourse;
  }
  if (config.onEditRoom) {
    runtimeConfig.onEditRoom = config.onEditRoom;
  }
  if (config.onBuildRoom) {
    runtimeConfig.onBuildRoom = config.onBuildRoom;
  }
  if (config.onOpenCourseBuilder) {
    runtimeConfig.onOpenCourseBuilder = config.onOpenCourseBuilder;
  }
  if (config.onJumpToCoordinates) {
    runtimeConfig.onJumpToCoordinates = config.onJumpToCoordinates;
  }
  if (config.onZoomIn) {
    runtimeConfig.onZoomIn = config.onZoomIn;
  }
  if (config.onZoomOut) {
    runtimeConfig.onZoomOut = config.onZoomOut;
  }
  if (config.onOpenExplore) {
    runtimeConfig.onOpenExplore = config.onOpenExplore;
  }
  if (config.onOpenLeaderboard) {
    runtimeConfig.onOpenLeaderboard = config.onOpenLeaderboard;
  }
  if (config.onOpenRoomRush) {
    runtimeConfig.onOpenRoomRush = config.onOpenRoomRush;
  }
  if (config.onOpenRoomComment) {
    runtimeConfig.onOpenRoomComment = config.onOpenRoomComment;
  }
  if (config.onToggleRoomComments) {
    runtimeConfig.onToggleRoomComments = config.onToggleRoomComments;
  }
  if (config.onOpenSettings) {
    runtimeConfig.onOpenSettings = config.onOpenSettings;
  }
  if (config.onOpenMultiplayer) {
    runtimeConfig.onOpenMultiplayer = config.onOpenMultiplayer;
  }
  if (config.onInviteMultiplayer) {
    runtimeConfig.onInviteMultiplayer = config.onInviteMultiplayer;
  }
  if (config.onOpenControls) {
    runtimeConfig.onOpenControls = config.onOpenControls;
  }
  if (config.onFitWorld) {
    runtimeConfig.onFitWorld = config.onFitWorld;
  }
}

export interface OverworldHudViewModel {
  saveStatusTone: 'default' | 'play-score' | 'challenge-active' | 'challenge-complete' | 'challenge-failed';
  jumpInputValue: string;
  selectedTitleText: string;
  selectedSubtitleText: string;
  selectedTitleSize: 'normal' | 'compact' | 'tiny';
  selectedTitleTone: 'default' | 'minted';
  selectedCreatorCardVisible: boolean;
  selectedCreatorNameText: string;
  selectedCreatorFallbackText: string;
  selectedCreatorPlayerLevelText: string;
  selectedCreatorPlayerProgressFraction: number;
  selectedCreatorCuratorLevelText: string;
  selectedCreatorCuratorProgressFraction: number;
  selectedCreatorBuilderLevelText: string;
  selectedCreatorBuilderProgressFraction: number;
  selectedCreatorUserId: string | null;
  selectedStateVisible: boolean;
  selectedStateText: string;
  selectedStateTone: 'published' | 'minted' | 'claimed_unpublished' | 'draft' | 'frontier' | 'empty';
  selectedStateInfoVisible: boolean;
  selectedStateInfoText: string;
  selectedMetaText: string;
  selectedMetaTone: 'default' | 'challenge' | 'claimed_unpublished' | 'draft' | 'frontier';
  selectedGoalText: string;
  statusText: string;
  leaderboardText: string;
  rateRoomButtonVisible: boolean;
  rateRoomButtonText: string;
  rateRoomButtonDisabled: boolean;
  zoomLabelText: string;
  playButtonText: string;
  playButtonDisabled: boolean;
  playButtonActive: boolean;
  restartButtonText: string;
  restartButtonDisabled: boolean;
  restartButtonActive: boolean;
  restartButtonHidden: boolean;
  playCourseButtonText: string;
  playCourseButtonDisabled: boolean;
  playCourseButtonHidden: boolean;
  playCourseButtonActive: boolean;
  roomRushButtonText: string;
  roomRushButtonDisabled: boolean;
  roomRushButtonHidden: boolean;
  roomRushButtonActive: boolean;
  commentButtonText: string;
  commentButtonDisabled: boolean;
  commentButtonHidden: boolean;
  commentButtonActive: boolean;
  commentsToggleText: string;
  commentsToggleHidden: boolean;
  commentsToggleActive: boolean;
  courseBuilderButtonDisabled: boolean;
  courseBuilderButtonTitle: string;
  editButtonDisabled: boolean;
  editButtonTitle: string;
  buildButtonDisabled: boolean;
  roomCoordinatesText: string;
  cursorText: string;
  playersOnlineText: string;
  playersOnlineSummaryText: string;
  playersOnlineEntries: OverworldOnlineRosterViewEntry[];
  saveStatusText: string;
  bottomBarZoomText: string;
  goalPanelVisible: boolean;
  goalPanelTone: 'active' | 'complete' | 'failed';
  goalPanelRoomText: string;
  goalPanelGoalText: string;
  goalPanelTimerText: string;
  goalPanelProgressText: string;
  signPanelVisible: boolean;
  signPanelLabelText: string;
  signPanelText: string;
}

export interface OverworldOnlineRosterViewEntry {
  key: string;
  userId: string | null;
  displayName: string;
  roomText: string;
  roomCoordinates: RoomCoordinates;
  mode: 'browse' | 'play' | 'edit';
  isSelf: boolean;
  multiplayerInviteDisabled: boolean;
}

export class OverworldHudBridge {
  private readonly hudRoot: HTMLElement | null;
  private readonly selectedTitleEl: HTMLElement | null;
  private readonly selectedSubtitleEl: HTMLElement | null;
  private readonly selectedCreatorCardEl: HTMLButtonElement | null;
  private readonly selectedCreatorNameEl: HTMLElement | null;
  private readonly selectedCreatorPlayerLevelEl: HTMLElement | null;
  private readonly selectedCreatorPlayerProgressEl: HTMLElement | null;
  private readonly selectedCreatorCuratorLevelEl: HTMLElement | null;
  private readonly selectedCreatorCuratorProgressEl: HTMLElement | null;
  private readonly selectedCreatorBuilderLevelEl: HTMLElement | null;
  private readonly selectedCreatorBuilderProgressEl: HTMLElement | null;
  private readonly selectedCreatorEl: HTMLButtonElement | null;
  private readonly selectedStateWrapEl: HTMLElement | null;
  private readonly selectedStateEl: HTMLElement | null;
  private readonly selectedStateInfoWrapEl: HTMLElement | null;
  private readonly selectedStateInfoTooltipEl: HTMLElement | null;
  private readonly selectedMetaEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly selectedGoalEl: HTMLElement | null;
  private readonly leaderboardEl: HTMLElement | null;
  private readonly playButton: HTMLButtonElement | null;
  private readonly restartButton: HTMLButtonElement | null;
  private readonly playCourseButton: HTMLButtonElement | null;
  private readonly roomRushButton: HTMLButtonElement | null;
  private readonly commentButton: HTMLButtonElement | null;
  private readonly courseBuilderButton: HTMLButtonElement | null;
  private readonly editButton: HTMLButtonElement | null;
  private readonly buildButton: HTMLButtonElement | null;
  private readonly jumpInput: HTMLInputElement | null;
  private readonly jumpButton: HTMLButtonElement | null;
  private readonly zoomInButton: HTMLButtonElement | null;
  private readonly zoomOutButton: HTMLButtonElement | null;
  private readonly leaderboardButton: HTMLButtonElement | null;
  private readonly exploreButton: HTMLButtonElement | null;
  private readonly rateRoomButton: HTMLButtonElement | null;
  private readonly commentsToggleButton: HTMLButtonElement | null;
  private readonly settingsButton: HTMLButtonElement | null;
  private readonly controlsButton: HTMLButtonElement | null;
  private readonly zoomLabelEl: HTMLElement | null;
  private readonly roomCoordinatesEl: HTMLElement | null;
  private readonly separatorEl: HTMLElement | null;
  private readonly cursorEl: HTMLElement | null;
  private readonly playersOnlineWrapEl: HTMLElement | null;
  private readonly playersOnlineEl: HTMLButtonElement | null;
  private readonly playersOnlinePopoverEl: HTMLElement | null;
  private readonly playersOnlinePopoverSummaryEl: HTMLElement | null;
  private readonly playersOnlinePopoverEmptyEl: HTMLElement | null;
  private readonly playersOnlinePopoverListEl: HTMLElement | null;
  private readonly saveStatusEl: HTMLElement | null;
  private readonly fitButton: HTMLElement | null;
  private readonly bottomBarZoomEl: HTMLElement | null;
  private readonly goalPanelEl: HTMLElement | null;
  private readonly goalPanelRoomEl: HTMLElement | null;
  private readonly goalPanelGoalEl: HTMLElement | null;
  private readonly goalPanelTimerEl: HTMLElement | null;
  private readonly goalPanelProgressEl: HTMLElement | null;
  private readonly signPanelEl: HTMLElement | null;
  private readonly signPanelLabelEl: HTMLElement | null;
  private readonly signPanelTextEl: HTMLElement | null;
  private readonly mobileGoalFooterEl: HTMLElement | null;
  private readonly mobileGoalFooterGoalEl: HTMLElement | null;
  private readonly mobileGoalFooterProgressEl: HTMLElement | null;
  private readonly mobileGoalFooterTimerEl: HTMLElement | null;
  private destroyed = false;
  private playersOnlinePinned = false;
  private playersOnlineMultiplayerStage: 'roster' | 'modes' | 'invite' = 'roster';
  private selectedMultiplayerModeId: MultiplayerModeId | null = null;
  private selectedCreatorUserId: string | null = null;
  private lastPlayersOnlineEntriesSignature = '';

  private readonly handleSelectedCreatorClick = (event: MouseEvent): void => {
    if (!isOpenableProfileUserId(this.selectedCreatorUserId)) {
      return;
    }

    event.preventDefault();
    requestProfileOpen(this.selectedCreatorUserId);
  };

  private readonly handlePlayersOnlineClick = (event: MouseEvent): void => {
    if (!this.canShowPlayersOnlinePopover()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.playersOnlinePinned = !this.playersOnlinePinned;
    this.setPlayersOnlinePopoverOpen(this.playersOnlinePinned);
  };

  private readonly handlePlayersOnlinePointerEnter = (): void => {
    if (this.playersOnlinePinned || !this.canShowPlayersOnlinePopover()) {
      return;
    }

    this.setPlayersOnlinePopoverOpen(true);
  };

  private readonly handlePlayersOnlinePointerLeave = (event: PointerEvent): void => {
    if (this.playersOnlinePinned || !this.playersOnlineWrapEl) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && this.playersOnlineWrapEl.contains(nextTarget)) {
      return;
    }

    this.setPlayersOnlinePopoverOpen(false);
  };

  private readonly handlePlayersOnlineFocusIn = (): void => {
    if (this.playersOnlinePinned || !this.canShowPlayersOnlinePopover()) {
      return;
    }

    this.setPlayersOnlinePopoverOpen(true);
  };

  private readonly handlePlayersOnlineFocusOut = (event: FocusEvent): void => {
    if (this.playersOnlinePinned || !this.playersOnlineWrapEl) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && this.playersOnlineWrapEl.contains(nextTarget)) {
      return;
    }

    this.setPlayersOnlinePopoverOpen(false);
  };

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.playersOnlinePinned || !this.playersOnlineWrapEl) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && this.playersOnlineWrapEl.contains(target)) {
      return;
    }

    this.playersOnlinePinned = false;
    this.setPlayersOnlinePopoverOpen(false);
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }

    const popoverOpen = this.playersOnlinePopoverEl?.classList.contains('hidden') === false;
    if (!this.playersOnlinePinned && !popoverOpen) {
      return;
    }

    this.playersOnlinePinned = false;
    this.setPlayersOnlinePopoverOpen(false);
  };

  private readonly handlePlayRoomClick = (): void => {
    void runtimeConfig.onPlayRoom();
  };

  private readonly handleRestartRunClick = (): void => {
    void runtimeConfig.onRestartRun();
  };

  private readonly handlePlayCourseClick = (): void => {
    void runtimeConfig.onPlayCourse();
  };

  private readonly handleRoomRushClick = (): void => {
    void runtimeConfig.onOpenRoomRush();
  };

  private readonly handleRoomCommentClick = (): void => {
    void runtimeConfig.onOpenRoomComment();
  };

  private readonly handleCommentsToggleClick = (): void => {
    void runtimeConfig.onToggleRoomComments();
  };

  private readonly handleSettingsClick = (): void => {
    void runtimeConfig.onOpenSettings();
  };

  private readonly handleEditRoomClick = (): void => {
    void runtimeConfig.onEditRoom();
  };

  private readonly handleBuildRoomClick = (): void => {
    void runtimeConfig.onBuildRoom();
  };

  private readonly handleOpenCourseBuilderClick = (): void => {
    void runtimeConfig.onOpenCourseBuilder();
  };

  private readonly handleZoomInClick = (): void => {
    runtimeConfig.onZoomIn();
  };

  private readonly handleZoomOutClick = (): void => {
    runtimeConfig.onZoomOut();
  };

  private readonly handleLeaderboardClick = (): void => {
    void runtimeConfig.onOpenLeaderboard();
  };

  private readonly handleExploreClick = (): void => {
    void runtimeConfig.onOpenExplore();
  };

  private readonly handleControlsClick = (): void => {
    void runtimeConfig.onOpenControls();
  };

  private readonly handleFitWorldClick = (): void => {
    runtimeConfig.onFitWorld();
  };

  private readonly handleJumpSubmit = (): void => {
    if (!this.jumpInput) {
      return;
    }

    const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(this.jumpInput.value);
    if (!match) {
      return;
    }

    void runtimeConfig.onJumpToCoordinates({
      x: Number(match[1]),
      y: Number(match[2]),
    });
  };

  private readonly handleJumpInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return;
    }

    this.handleJumpSubmit();
  };

  constructor(private readonly doc: Document = document) {
    this.hudRoot = this.doc.getElementById('world-hud');
    this.selectedTitleEl = this.doc.getElementById('world-selected-title');
    this.selectedSubtitleEl = this.doc.getElementById('world-selected-subtitle');
    this.selectedCreatorCardEl = this.doc.getElementById('world-selected-creator-card') as HTMLButtonElement | null;
    this.selectedCreatorNameEl = this.doc.getElementById('world-selected-creator-name');
    this.selectedCreatorPlayerLevelEl = this.doc.getElementById('world-selected-creator-player-level');
    this.selectedCreatorPlayerProgressEl = this.doc.getElementById('world-selected-creator-player-progress');
    this.selectedCreatorCuratorLevelEl = this.doc.getElementById('world-selected-creator-curator-level');
    this.selectedCreatorCuratorProgressEl = this.doc.getElementById('world-selected-creator-curator-progress');
    this.selectedCreatorBuilderLevelEl = this.doc.getElementById('world-selected-creator-builder-level');
    this.selectedCreatorBuilderProgressEl = this.doc.getElementById('world-selected-creator-builder-progress');
    this.selectedCreatorEl = this.doc.getElementById('world-selected-coords') as HTMLButtonElement | null;
    this.selectedStateWrapEl = this.doc.getElementById('world-selected-state-wrap');
    this.selectedStateEl = this.doc.getElementById('world-selected-state');
    this.selectedStateInfoWrapEl = this.doc.getElementById('world-selected-state-info-wrap');
    this.selectedStateInfoTooltipEl = this.doc.getElementById('world-selected-state-info-tooltip');
    this.selectedMetaEl = this.doc.getElementById('world-selected-meta');
    this.statusEl = this.doc.getElementById('world-status');
    this.selectedGoalEl = this.doc.getElementById('world-selected-goal');
    this.leaderboardEl = this.doc.getElementById('world-leaderboard');
    this.playButton = this.doc.getElementById('btn-world-play') as HTMLButtonElement | null;
    this.restartButton = this.doc.getElementById('btn-world-restart') as HTMLButtonElement | null;
    this.playCourseButton = this.doc.getElementById('btn-world-play-course') as HTMLButtonElement | null;
    this.roomRushButton = this.doc.getElementById('btn-world-room-rush') as HTMLButtonElement | null;
    this.commentButton = this.doc.getElementById('btn-world-comment') as HTMLButtonElement | null;
    this.courseBuilderButton = this.doc.getElementById('btn-world-course-builder') as HTMLButtonElement | null;
    this.editButton = this.doc.getElementById('btn-world-edit') as HTMLButtonElement | null;
    this.buildButton = this.doc.getElementById('btn-world-build') as HTMLButtonElement | null;
    this.jumpInput = this.doc.getElementById('world-jump-input') as HTMLInputElement | null;
    this.jumpButton = this.doc.getElementById('btn-world-jump') as HTMLButtonElement | null;
    this.zoomInButton = this.doc.getElementById('btn-world-zoom-in-footer') as HTMLButtonElement | null;
    this.zoomOutButton = this.doc.getElementById('btn-world-zoom-out-footer') as HTMLButtonElement | null;
    this.exploreButton = this.doc.getElementById('btn-world-explore') as HTMLButtonElement | null;
    this.leaderboardButton = this.doc.getElementById('btn-world-leaderboard') as HTMLButtonElement | null;
    this.rateRoomButton = this.doc.getElementById('btn-world-rate-room') as HTMLButtonElement | null;
    this.commentsToggleButton = this.doc.getElementById('btn-world-comments-toggle') as HTMLButtonElement | null;
    this.settingsButton = this.doc.getElementById('btn-world-settings') as HTMLButtonElement | null;
    this.controlsButton = this.doc.getElementById('btn-world-controls') as HTMLButtonElement | null;
    this.zoomLabelEl = this.doc.getElementById('world-zoom-label');
    this.roomCoordinatesEl = this.doc.getElementById('room-coords');
    this.separatorEl = this.doc.querySelector('#bottom-bar .separator');
    this.cursorEl = this.doc.getElementById('cursor-coords');
    this.playersOnlineWrapEl = this.doc.getElementById('world-online-wrap');
    this.playersOnlineEl = this.doc.getElementById('world-online-count') as HTMLButtonElement | null;
    this.playersOnlinePopoverEl = this.doc.getElementById('world-online-popover');
    this.playersOnlinePopoverSummaryEl = this.doc.getElementById('world-online-popover-summary');
    this.playersOnlinePopoverEmptyEl = this.doc.getElementById('world-online-popover-empty');
    this.playersOnlinePopoverListEl = this.doc.getElementById('world-online-popover-list');
    this.saveStatusEl = this.doc.getElementById('room-save-status');
    this.fitButton = this.doc.getElementById('btn-fit-screen');
    this.bottomBarZoomEl = this.doc.getElementById('zoom-level');
    this.goalPanelEl = this.doc.getElementById('world-goal-panel');
    this.goalPanelRoomEl = this.doc.getElementById('world-goal-panel-room');
    this.goalPanelGoalEl = this.doc.getElementById('world-goal-panel-goal');
    this.goalPanelTimerEl = this.doc.getElementById('world-goal-panel-timer');
    this.goalPanelProgressEl = this.doc.getElementById('world-goal-panel-progress');
    this.signPanelEl = this.doc.getElementById('world-sign-panel');
    this.signPanelLabelEl = this.doc.getElementById('world-sign-panel-label');
    this.signPanelTextEl = this.doc.getElementById('world-sign-panel-text');
    this.mobileGoalFooterEl = this.doc.getElementById('mobile-goal-footer');
    this.mobileGoalFooterGoalEl = this.doc.getElementById('mobile-goal-footer-goal');
    this.mobileGoalFooterProgressEl = this.doc.getElementById('mobile-goal-footer-progress');
    this.mobileGoalFooterTimerEl = this.doc.getElementById('mobile-goal-footer-timer');

    this.playersOnlineWrapEl?.addEventListener('pointerenter', this.handlePlayersOnlinePointerEnter);
    this.playersOnlineWrapEl?.addEventListener('pointerleave', this.handlePlayersOnlinePointerLeave);
    this.playersOnlineWrapEl?.addEventListener('focusin', this.handlePlayersOnlineFocusIn);
    this.playersOnlineWrapEl?.addEventListener('focusout', this.handlePlayersOnlineFocusOut);
    this.playersOnlineEl?.addEventListener('click', this.handlePlayersOnlineClick);
    this.selectedCreatorCardEl?.addEventListener('click', this.handleSelectedCreatorClick);
    this.selectedCreatorEl?.addEventListener('click', this.handleSelectedCreatorClick);
    this.playButton?.addEventListener('click', this.handlePlayRoomClick);
    this.restartButton?.addEventListener('click', this.handleRestartRunClick);
    this.playCourseButton?.addEventListener('click', this.handlePlayCourseClick);
    this.roomRushButton?.addEventListener('click', this.handleRoomRushClick);
    this.commentButton?.addEventListener('click', this.handleRoomCommentClick);
    this.editButton?.addEventListener('click', this.handleEditRoomClick);
    this.buildButton?.addEventListener('click', this.handleBuildRoomClick);
    this.courseBuilderButton?.addEventListener('click', this.handleOpenCourseBuilderClick);
    this.jumpButton?.addEventListener('click', this.handleJumpSubmit);
    this.jumpInput?.addEventListener('keydown', this.handleJumpInputKeyDown);
    this.zoomInButton?.addEventListener('click', this.handleZoomInClick);
    this.zoomOutButton?.addEventListener('click', this.handleZoomOutClick);
    this.exploreButton?.addEventListener('click', this.handleExploreClick);
    this.leaderboardButton?.addEventListener('click', this.handleLeaderboardClick);
    this.rateRoomButton?.addEventListener('click', this.handleLeaderboardClick);
    this.commentsToggleButton?.addEventListener('click', this.handleCommentsToggleClick);
    this.settingsButton?.addEventListener('click', this.handleSettingsClick);
    this.controlsButton?.addEventListener('click', this.handleControlsClick);
    this.fitButton?.addEventListener('click', this.handleFitWorldClick);
    this.doc.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.doc.addEventListener('keydown', this.handleDocumentKeyDown, true);
  }

  render(viewModel: OverworldHudViewModel): void {
    if (this.destroyed) {
      return;
    }

    this.hudRoot?.classList.remove('hidden');
    this.fitButton?.classList.remove('hidden');

    if (this.jumpInput && this.doc.activeElement !== this.jumpInput && this.jumpInput.value !== viewModel.jumpInputValue) {
      this.jumpInput.value = viewModel.jumpInputValue;
    }

    this.setText(this.selectedTitleEl, viewModel.selectedTitleText);
    this.setText(this.selectedSubtitleEl, viewModel.selectedSubtitleText);
    this.setTitleSize(this.selectedTitleEl, viewModel.selectedTitleSize);
    this.setTitleTone(viewModel.selectedTitleTone);
    this.renderSelectedCreator(
      viewModel.selectedCreatorCardVisible,
      viewModel.selectedCreatorNameText,
      viewModel.selectedCreatorFallbackText,
      viewModel.selectedCreatorPlayerLevelText,
      viewModel.selectedCreatorPlayerProgressFraction,
      viewModel.selectedCreatorCuratorLevelText,
      viewModel.selectedCreatorCuratorProgressFraction,
      viewModel.selectedCreatorBuilderLevelText,
      viewModel.selectedCreatorBuilderProgressFraction,
      viewModel.selectedCreatorUserId,
    );
    this.setStateVisible(viewModel.selectedStateVisible);
    this.setText(this.selectedStateEl, viewModel.selectedStateText);
    this.setStateTone(viewModel.selectedStateTone);
    this.renderSelectedStateInfo(viewModel.selectedStateInfoVisible, viewModel.selectedStateInfoText);
    this.setText(this.selectedMetaEl, viewModel.selectedMetaText);
    this.setMetaTone(viewModel.selectedMetaTone);
    this.setText(this.statusEl, viewModel.statusText);
    this.setText(this.selectedGoalEl, viewModel.selectedGoalText);
    this.setText(this.leaderboardEl, viewModel.leaderboardText);
    this.setButton(
      this.rateRoomButton,
      viewModel.rateRoomButtonText,
      viewModel.rateRoomButtonDisabled,
    );
    this.rateRoomButton?.classList.toggle('hidden', !viewModel.rateRoomButtonVisible);
    this.setText(this.zoomLabelEl, viewModel.zoomLabelText);
    this.setText(this.roomCoordinatesEl, viewModel.roomCoordinatesText);
    this.setText(this.cursorEl, viewModel.cursorText);
    this.setSeparatorVisible(Boolean(viewModel.roomCoordinatesText && viewModel.cursorText));
    this.renderPlayersOnline(viewModel);
    this.setText(this.saveStatusEl, viewModel.saveStatusText);
    this.setSaveStatusTone(viewModel.saveStatusTone);
    this.setText(this.bottomBarZoomEl, viewModel.bottomBarZoomText);
    this.setButton(this.playButton, viewModel.playButtonText, viewModel.playButtonDisabled);
    this.setActive(this.playButton, viewModel.playButtonActive);
    this.setButton(this.restartButton, viewModel.restartButtonText, viewModel.restartButtonDisabled);
    this.setActive(this.restartButton, viewModel.restartButtonActive);
    this.restartButton?.classList.toggle('hidden', viewModel.restartButtonHidden);
    this.setButton(
      this.playCourseButton,
      viewModel.playCourseButtonText,
      viewModel.playCourseButtonDisabled
    );
    this.setActive(this.playCourseButton, viewModel.playCourseButtonActive);
    this.playCourseButton?.classList.toggle('hidden', viewModel.playCourseButtonHidden);
    this.setButton(
      this.roomRushButton,
      viewModel.roomRushButtonText,
      viewModel.roomRushButtonDisabled,
    );
    this.setActive(this.roomRushButton, viewModel.roomRushButtonActive);
    this.roomRushButton?.classList.toggle('hidden', viewModel.roomRushButtonHidden);
    this.setButton(
      this.commentButton,
      viewModel.commentButtonText,
      viewModel.commentButtonDisabled,
    );
    this.setActive(this.commentButton, viewModel.commentButtonActive);
    this.commentButton?.classList.toggle('hidden', viewModel.commentButtonHidden);
    this.setButton(this.commentsToggleButton, viewModel.commentsToggleText, false);
    this.commentsToggleButton?.classList.toggle('hidden', viewModel.commentsToggleHidden);
    this.commentsToggleButton?.setAttribute(
      'data-comments-visible',
      viewModel.commentsToggleActive ? 'true' : 'false',
    );
    this.setDisabled(this.courseBuilderButton, viewModel.courseBuilderButtonDisabled);
    this.setTitle(this.courseBuilderButton, viewModel.courseBuilderButtonTitle);
    this.setDisabled(this.editButton, viewModel.editButtonDisabled);
    this.setTitle(this.editButton, viewModel.editButtonTitle);
    this.setDisabled(this.buildButton, viewModel.buildButtonDisabled);
    this.renderGoalPanel(viewModel);
    this.renderSignPanel(viewModel);
  }

  destroy(): void {
    this.destroyed = true;
    this.playersOnlineWrapEl?.removeEventListener('pointerenter', this.handlePlayersOnlinePointerEnter);
    this.playersOnlineWrapEl?.removeEventListener('pointerleave', this.handlePlayersOnlinePointerLeave);
    this.playersOnlineWrapEl?.removeEventListener('focusin', this.handlePlayersOnlineFocusIn);
    this.playersOnlineWrapEl?.removeEventListener('focusout', this.handlePlayersOnlineFocusOut);
    this.playersOnlineEl?.removeEventListener('click', this.handlePlayersOnlineClick);
    this.selectedCreatorCardEl?.removeEventListener('click', this.handleSelectedCreatorClick);
    this.selectedCreatorEl?.removeEventListener('click', this.handleSelectedCreatorClick);
    this.playButton?.removeEventListener('click', this.handlePlayRoomClick);
    this.restartButton?.removeEventListener('click', this.handleRestartRunClick);
    this.playCourseButton?.removeEventListener('click', this.handlePlayCourseClick);
    this.roomRushButton?.removeEventListener('click', this.handleRoomRushClick);
    this.commentButton?.removeEventListener('click', this.handleRoomCommentClick);
    this.editButton?.removeEventListener('click', this.handleEditRoomClick);
    this.buildButton?.removeEventListener('click', this.handleBuildRoomClick);
    this.courseBuilderButton?.removeEventListener('click', this.handleOpenCourseBuilderClick);
    this.jumpButton?.removeEventListener('click', this.handleJumpSubmit);
    this.jumpInput?.removeEventListener('keydown', this.handleJumpInputKeyDown);
    this.zoomInButton?.removeEventListener('click', this.handleZoomInClick);
    this.zoomOutButton?.removeEventListener('click', this.handleZoomOutClick);
    this.exploreButton?.removeEventListener('click', this.handleExploreClick);
    this.leaderboardButton?.removeEventListener('click', this.handleLeaderboardClick);
    this.rateRoomButton?.removeEventListener('click', this.handleLeaderboardClick);
    this.commentsToggleButton?.removeEventListener('click', this.handleCommentsToggleClick);
    this.settingsButton?.removeEventListener('click', this.handleSettingsClick);
    this.controlsButton?.removeEventListener('click', this.handleControlsClick);
    this.fitButton?.removeEventListener('click', this.handleFitWorldClick);
    this.doc.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.doc.removeEventListener('keydown', this.handleDocumentKeyDown, true);
  }

  private setText(element: HTMLElement | null, text: string): void {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  private setTitleSize(
    element: HTMLElement | null,
    size: OverworldHudViewModel['selectedTitleSize'],
  ): void {
    if (!element) {
      return;
    }

    if (element.dataset.titleSize !== size) {
      element.dataset.titleSize = size;
    }
  }

  private setTitleTone(
    tone: OverworldHudViewModel['selectedTitleTone'],
  ): void {
    if (!this.selectedTitleEl) {
      return;
    }

    this.selectedTitleEl.dataset.worldTitleTone = tone;
  }

  private setTitle(element: HTMLElement | null, title: string): void {
    if (!element) {
      return;
    }

    if (title.trim().length === 0) {
      element.removeAttribute('title');
      return;
    }

    if (element.getAttribute('title') !== title) {
      element.setAttribute('title', title);
    }
  }

  private setDisabled(element: HTMLButtonElement | null, disabled: boolean): void {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setActive(element: HTMLElement | null, active: boolean): void {
    element?.classList.toggle('active', active);
  }

  private setButton(element: HTMLButtonElement | null, text: string, disabled: boolean): void {
    if (!element) {
      return;
    }

    if (element.textContent !== text) {
      element.textContent = text;
    }

    if (element.disabled !== disabled) {
      element.disabled = disabled;
    }
  }

  private setSaveStatusTone(
    tone: OverworldHudViewModel['saveStatusTone']
  ): void {
    if (!this.saveStatusEl) {
      return;
    }

    if (tone === 'default') {
      this.saveStatusEl.removeAttribute('data-overworld-tone');
      return;
    }

    this.saveStatusEl.setAttribute('data-overworld-tone', tone);
  }

  private setStateTone(
    tone: OverworldHudViewModel['selectedStateTone']
  ): void {
    if (!this.selectedStateEl) {
      return;
    }

    this.selectedStateEl.setAttribute('data-world-state-tone', tone);
  }

  private setStateVisible(visible: boolean): void {
    this.selectedStateWrapEl?.classList.toggle('hidden', !visible);
  }

  private setMetaTone(
    tone: OverworldHudViewModel['selectedMetaTone']
  ): void {
    if (!this.selectedMetaEl) {
      return;
    }

    this.selectedMetaEl.setAttribute('data-world-meta-tone', tone);
  }

  private setSeparatorVisible(visible: boolean): void {
    this.separatorEl?.classList.toggle('hidden', !visible);
  }

  private renderPlayersOnline(viewModel: OverworldHudViewModel): void {
    this.setText(this.playersOnlineEl, viewModel.playersOnlineText);
    this.setText(this.playersOnlinePopoverSummaryEl, viewModel.playersOnlineSummaryText);

    const showPlayersOnline = viewModel.playersOnlineText.trim().length > 0;
    this.playersOnlineWrapEl?.classList.toggle('hidden', !showPlayersOnline);

    if (!showPlayersOnline) {
      this.playersOnlinePinned = false;
      this.resetPlayersOnlineMultiplayerLauncher();
      this.setPlayersOnlinePopoverOpen(false);
      this.lastPlayersOnlineEntriesSignature = '';
      return;
    }

    if (this.playersOnlinePopoverEmptyEl) {
      this.playersOnlinePopoverEmptyEl.classList.toggle(
        'hidden',
        this.playersOnlineMultiplayerStage !== 'roster' || viewModel.playersOnlineEntries.length > 0,
      );
    }

    if (this.playersOnlinePopoverListEl) {
      const entriesSignature = [
        this.playersOnlineMultiplayerStage,
        this.selectedMultiplayerModeId ?? '',
        ...viewModel.playersOnlineEntries
        .map((entry) => [
          entry.key,
          entry.userId ?? '',
          entry.displayName,
          entry.roomText,
          entry.roomCoordinates.x,
          entry.roomCoordinates.y,
          entry.mode,
          entry.isSelf ? '1' : '0',
          entry.multiplayerInviteDisabled ? '1' : '0',
        ].join('\u001f')),
      ].join('\u001e');
      if (entriesSignature === this.lastPlayersOnlineEntriesSignature) {
        return;
      }

      this.lastPlayersOnlineEntriesSignature = entriesSignature;
      const sections: HTMLElement[] = [];

      if (this.playersOnlineMultiplayerStage === 'modes') {
        sections.push(this.createMultiplayerModePicker(viewModel));
      } else if (this.playersOnlineMultiplayerStage === 'invite' && this.selectedMultiplayerModeId) {
        sections.push(this.createMultiplayerInvitePicker(viewModel, this.selectedMultiplayerModeId));
      } else {
        sections.push(this.createMultiplayerLauncher(viewModel));
        const playEntries = viewModel.playersOnlineEntries.filter((entry) => entry.mode === 'play');
        const editEntries = viewModel.playersOnlineEntries.filter((entry) => entry.mode === 'edit');
        const browseEntries = viewModel.playersOnlineEntries.filter((entry) => entry.mode === 'browse');

        if (playEntries.length > 0) {
          sections.push(this.createPlayersOnlineSection('play', playEntries));
        }
        if (editEntries.length > 0) {
          sections.push(this.createPlayersOnlineSection('edit', editEntries));
        }
        if (browseEntries.length > 0) {
          sections.push(this.createPlayersOnlineSection('browse', browseEntries));
        }
      }

      this.playersOnlinePopoverListEl.replaceChildren(...sections);
    }
  }

  private createPlayersOnlineEntry(entry: OverworldOnlineRosterViewEntry): HTMLElement {
    const row = this.doc.createElement('button');
    row.type = 'button';
    row.className = 'world-online-popover-entry';
    row.dataset.onlineKey = entry.key;
    row.dataset.onlineMode = entry.mode;
    row.disabled = entry.isSelf;
    row.title =
      entry.isSelf
        ? ''
        : entry.mode === 'play'
          ? `Join ${entry.displayName} in ${entry.roomText}`
          : `Warp to ${entry.displayName} in ${entry.roomText}`;
    row.addEventListener('click', () => {
      if (entry.isSelf) {
        return;
      }

      this.playersOnlinePinned = false;
      this.setPlayersOnlinePopoverOpen(false);
      void (async () => {
        await runtimeConfig.onJumpToCoordinates(entry.roomCoordinates);
        if (entry.mode === 'play') {
          await runtimeConfig.onPlayRoom();
        }
      })();
    });

    const name = this.doc.createElement('div');
    name.className = 'world-online-popover-entry-name';
    name.textContent = entry.isSelf ? `${entry.displayName} (You)` : entry.displayName;
    name.dataset.onlineSelf = entry.isSelf ? 'true' : 'false';

    const room = this.doc.createElement('div');
    room.className = 'world-online-popover-room';
    room.textContent = entry.roomText;

    row.append(name, room);
    return row;
  }

  private createMultiplayerLauncher(viewModel: OverworldHudViewModel): HTMLElement {
    const wrap = this.doc.createElement('div');
    wrap.className = 'world-online-multiplayer-launcher';

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'world-online-multiplayer-btn';
    button.textContent = 'Multiplayer';
    button.addEventListener('click', () => {
      void (async () => {
        const canOpen = await runtimeConfig.onOpenMultiplayer();
        if (!canOpen) {
          return;
        }
        this.playersOnlineMultiplayerStage = 'modes';
        this.selectedMultiplayerModeId = null;
        this.lastPlayersOnlineEntriesSignature = '';
        this.renderPlayersOnline(viewModel);
      })();
    });

    wrap.append(button);
    return wrap;
  }

  private createMultiplayerModePicker(viewModel: OverworldHudViewModel): HTMLElement {
    const wrap = this.doc.createElement('section');
    wrap.className = 'world-online-multiplayer-panel';

    const header = this.createMultiplayerPanelHeader('Choose Mode', () => {
      this.playersOnlineMultiplayerStage = 'roster';
      this.selectedMultiplayerModeId = null;
      this.lastPlayersOnlineEntriesSignature = '';
      this.renderPlayersOnline(viewModel);
    });

    const list = this.doc.createElement('div');
    list.className = 'world-online-multiplayer-modes';

    for (const mode of MULTIPLAYER_MODE_LIST) {
      const card = this.doc.createElement('button');
      card.type = 'button';
      card.className = 'world-online-multiplayer-mode-card';
      card.dataset.multiplayerMode = mode.id;
      card.textContent = mode.displayName;
      card.addEventListener('click', () => {
        this.playersOnlineMultiplayerStage = 'invite';
        this.selectedMultiplayerModeId = mode.id;
        this.lastPlayersOnlineEntriesSignature = '';
        this.renderPlayersOnline(viewModel);
      });
      list.append(card);
    }

    wrap.append(header, list);
    return wrap;
  }

  private createMultiplayerInvitePicker(
    viewModel: OverworldHudViewModel,
    modeId: MultiplayerModeId,
  ): HTMLElement {
    const mode = getMultiplayerModeDefinition(modeId);
    const wrap = this.doc.createElement('section');
    wrap.className = 'world-online-multiplayer-panel';

    const header = this.createMultiplayerPanelHeader(`Invite: ${mode.displayName}`, () => {
      this.playersOnlineMultiplayerStage = 'modes';
      this.selectedMultiplayerModeId = null;
      this.lastPlayersOnlineEntriesSignature = '';
      this.renderPlayersOnline(viewModel);
    });

    const list = this.doc.createElement('div');
    list.className = 'world-online-multiplayer-invite-list';

    const candidates = viewModel.playersOnlineEntries.filter(
      (entry) => !entry.isSelf && !entry.multiplayerInviteDisabled,
    );
    for (const entry of candidates) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = 'world-online-multiplayer-invite-entry';
      button.dataset.disabled = entry.multiplayerInviteDisabled ? 'true' : 'false';
      button.disabled = entry.multiplayerInviteDisabled;
      button.title = entry.multiplayerInviteDisabled
        ? ''
        : `Invite ${entry.displayName} to ${mode.displayName}`;

      const name = this.doc.createElement('span');
      name.className = 'world-online-popover-entry-name';
      name.textContent = entry.displayName;

      const room = this.doc.createElement('span');
      room.className = 'world-online-popover-room';
      room.textContent = entry.roomText;

      button.append(name, room);
      button.addEventListener('click', () => {
        if (entry.multiplayerInviteDisabled) {
          return;
        }

        this.playersOnlinePinned = false;
        this.resetPlayersOnlineMultiplayerLauncher();
        this.setPlayersOnlinePopoverOpen(false);
        void runtimeConfig.onInviteMultiplayer(modeId, entry);
      });
      list.append(button);
    }

    if (candidates.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = 'world-online-multiplayer-empty';
      empty.textContent = 'No players available to invite.';
      list.append(empty);
    }

    wrap.append(header, list);
    return wrap;
  }

  private createMultiplayerPanelHeader(label: string, onBack: () => void): HTMLElement {
    const header = this.doc.createElement('div');
    header.className = 'world-online-multiplayer-panel-header';

    const back = this.doc.createElement('button');
    back.type = 'button';
    back.className = 'world-online-multiplayer-back';
    back.textContent = 'Back';
    back.addEventListener('click', onBack);

    const title = this.doc.createElement('div');
    title.className = 'world-online-multiplayer-panel-title';
    title.textContent = label;

    header.append(back, title);
    return header;
  }

  private createPlayersOnlineSection(
    mode: OverworldOnlineRosterViewEntry['mode'],
    entries: OverworldOnlineRosterViewEntry[],
  ): HTMLElement {
    const section = this.doc.createElement('section');
    section.className = 'world-online-popover-section';
    section.dataset.onlineMode = mode;

    const title = this.doc.createElement('div');
    title.className = 'world-online-popover-section-title';
    title.dataset.onlineMode = mode;
    title.textContent =
      mode === 'play' ? 'Playing' : mode === 'edit' ? 'Building' : 'Browsing';

    const list = this.doc.createElement('div');
    list.className = 'world-online-popover-section-list';
    list.append(...entries.map((entry) => this.createPlayersOnlineEntry(entry)));

    section.append(title, list);
    return section;
  }

  private renderSelectedCreator(
    cardVisible: boolean,
    nameText: string,
    fallbackText: string,
    playerLevelText: string,
    playerProgressFraction: number,
    curatorLevelText: string,
    curatorProgressFraction: number,
    builderLevelText: string,
    builderProgressFraction: number,
    userId: string | null,
  ): void {
    this.selectedCreatorUserId = userId;
    const clickable = isOpenableProfileUserId(userId);
    const profileTitle = clickable && nameText.trim().length > 0
      ? `View ${nameText}'s profile`
      : '';

    if (this.selectedCreatorCardEl) {
      this.selectedCreatorCardEl.classList.toggle('hidden', !cardVisible);
      this.setDisabled(this.selectedCreatorCardEl, !clickable);
      this.selectedCreatorCardEl.classList.toggle('is-clickable', clickable);
      this.setTitle(this.selectedCreatorCardEl, cardVisible ? profileTitle : '');
    }
    this.setText(this.selectedCreatorNameEl, nameText);
    this.renderCreatorStatLevel(this.selectedCreatorPlayerLevelEl, playerLevelText);
    this.renderCreatorStatProgress(this.selectedCreatorPlayerProgressEl, playerProgressFraction);
    this.renderCreatorStatLevel(this.selectedCreatorCuratorLevelEl, curatorLevelText);
    this.renderCreatorStatProgress(this.selectedCreatorCuratorProgressEl, curatorProgressFraction);
    this.renderCreatorStatLevel(this.selectedCreatorBuilderLevelEl, builderLevelText);
    this.renderCreatorStatProgress(this.selectedCreatorBuilderProgressEl, builderProgressFraction);

    if (!this.selectedCreatorEl) {
      return;
    }

    this.setText(this.selectedCreatorEl, fallbackText);
    this.selectedCreatorEl.classList.toggle('hidden', cardVisible);
    this.setDisabled(this.selectedCreatorEl, !clickable);
    this.selectedCreatorEl.classList.toggle('is-clickable', clickable);
    this.setTitle(this.selectedCreatorEl, !cardVisible ? profileTitle : '');
  }

  private renderCreatorStatLevel(element: HTMLElement | null, levelText: string): void {
    if (!element) {
      return;
    }

    const level = Number.parseInt(levelText, 10);
    const iconSrc = element.dataset.iconSrc?.trim() ?? '';
    const iconLabel = element.dataset.iconLabel?.trim() ?? 'Level';

    if (!Number.isFinite(level) || level <= 0 || !iconSrc) {
      element.dataset.placeholder = 'true';
      element.setAttribute('aria-label', `${iconLabel} level unavailable`);
      if (element.textContent !== '--') {
        element.replaceChildren(this.doc.createTextNode('--'));
      }
      return;
    }

    if (element.dataset.levelValue === String(level) && element.dataset.placeholder !== 'true') {
      return;
    }

    const icon = this.doc.createElement('img');
    icon.className = 'mini-profile-stat-level-icon';
    icon.src = iconSrc;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');

    const label = this.doc.createElement('span');
    label.className = 'mini-profile-stat-level-label';
    label.textContent = `LVL ${level}`;

    element.dataset.levelValue = String(level);
    element.dataset.placeholder = 'false';
    element.setAttribute('aria-label', `${iconLabel} level ${level}`);
    element.replaceChildren(icon, label);
  }

  private renderCreatorStatProgress(element: HTMLElement | null, fraction: number): void {
    if (!element) {
      return;
    }

    const clamped = Math.max(0, Math.min(1, fraction));
    const width = `${(clamped * 100).toFixed(1)}%`;
    if (element.style.width !== width) {
      element.style.width = width;
    }
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', '100');
    element.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
  }

  private renderSelectedStateInfo(visible: boolean, text: string): void {
    this.selectedStateInfoWrapEl?.classList.toggle('hidden', !visible);
    this.setText(this.selectedStateInfoTooltipEl, text);
  }

  private canShowPlayersOnlinePopover(): boolean {
    return Boolean(this.playersOnlineWrapEl && !this.playersOnlineWrapEl.classList.contains('hidden'));
  }

  private setPlayersOnlinePopoverOpen(open: boolean): void {
    if (!open) {
      this.resetPlayersOnlineMultiplayerLauncher();
    }
    this.playersOnlineWrapEl?.classList.toggle('is-open', open);
    this.playersOnlinePopoverEl?.classList.toggle('hidden', !open);
    this.playersOnlinePopoverEl?.setAttribute('aria-hidden', open ? 'false' : 'true');
    this.playersOnlineEl?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  private resetPlayersOnlineMultiplayerLauncher(): void {
    this.playersOnlineMultiplayerStage = 'roster';
    this.selectedMultiplayerModeId = null;
  }

  private renderGoalPanel(viewModel: OverworldHudViewModel): void {
    if (!this.goalPanelEl) {
      this.renderMobileGoalFooter(viewModel);
      return;
    }

    this.updateGoalPanelDockPosition();
    this.goalPanelEl.classList.toggle('hidden', !viewModel.goalPanelVisible);
    this.goalPanelEl.setAttribute('data-goal-panel-tone', viewModel.goalPanelTone);
    this.setText(this.goalPanelRoomEl, viewModel.goalPanelRoomText);
    this.setText(this.goalPanelGoalEl, viewModel.goalPanelGoalText);
    this.setText(this.goalPanelTimerEl, viewModel.goalPanelTimerText);
    this.setText(this.goalPanelProgressEl, viewModel.goalPanelProgressText);
    this.renderMobileGoalFooter(viewModel);
  }

  private renderMobileGoalFooter(viewModel: OverworldHudViewModel): void {
    if (!this.mobileGoalFooterEl) {
      return;
    }

    this.mobileGoalFooterEl.classList.toggle('hidden', !viewModel.goalPanelVisible);
    this.mobileGoalFooterEl.setAttribute('data-goal-panel-tone', viewModel.goalPanelTone);
    this.setText(this.mobileGoalFooterGoalEl, viewModel.goalPanelGoalText || viewModel.goalPanelRoomText);
    this.setText(this.mobileGoalFooterProgressEl, viewModel.goalPanelProgressText || viewModel.goalPanelRoomText);
    this.setText(this.mobileGoalFooterTimerEl, viewModel.goalPanelTimerText);
  }

  private updateGoalPanelDockPosition(): void {
    if (!this.goalPanelEl) {
      return;
    }

    const authTopline = this.doc.querySelector('.auth-panel-topline');
    if (!(authTopline instanceof HTMLElement)) {
      this.goalPanelEl.style.removeProperty('--world-goal-panel-anchor-span');
      this.goalPanelEl.style.removeProperty('--world-goal-panel-available-width');
      return;
    }

    const viewportWidth = this.doc.documentElement.clientWidth || this.doc.body.clientWidth;
    const rect = authTopline.getBoundingClientRect();
    const anchorSpan = Math.max(16, viewportWidth - rect.left);
    const availableWidth = Math.max(210, rect.left - 28);

    this.goalPanelEl.style.setProperty('--world-goal-panel-anchor-span', `${anchorSpan}px`);
    this.goalPanelEl.style.setProperty('--world-goal-panel-available-width', `${availableWidth}px`);
  }

  private renderSignPanel(viewModel: OverworldHudViewModel): void {
    if (!this.signPanelEl) {
      return;
    }

    this.signPanelEl.classList.toggle('hidden', !viewModel.signPanelVisible);
    this.signPanelLabelEl?.classList.toggle('hidden', !viewModel.signPanelLabelText);
    this.setText(this.signPanelLabelEl, viewModel.signPanelLabelText);
    this.setText(this.signPanelTextEl, viewModel.signPanelText);
  }
}
