import { createProfileTriggerElement, isOpenableProfileUserId, requestProfileOpen } from '../../ui/setup/profileEvents';

export interface OverworldHudViewModel {
  saveStatusTone: 'default' | 'play-score' | 'challenge-active' | 'challenge-complete' | 'challenge-failed';
  jumpInputValue: string;
  selectedTitleText: string;
  selectedCreatorText: string;
  selectedCreatorUserId: string | null;
  selectedStateText: string;
  selectedStateTone: 'published' | 'minted' | 'draft' | 'frontier' | 'empty';
  selectedStateInfoVisible: boolean;
  selectedStateInfoText: string;
  selectedMetaText: string;
  selectedMetaTone: 'default' | 'challenge' | 'draft' | 'frontier';
  statusText: string;
  leaderboardText: string;
  zoomLabelText: string;
  playButtonText: string;
  playButtonDisabled: boolean;
  playButtonActive: boolean;
  playCourseButtonText: string;
  playCourseButtonDisabled: boolean;
  playCourseButtonHidden: boolean;
  playCourseButtonActive: boolean;
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
}

export interface OverworldOnlineRosterViewEntry {
  key: string;
  userId: string | null;
  displayName: string;
  roomText: string;
  isSelf: boolean;
}

export class OverworldHudBridge {
  private readonly hudRoot: HTMLElement | null;
  private readonly selectedTitleEl: HTMLElement | null;
  private readonly selectedCreatorEl: HTMLButtonElement | null;
  private readonly selectedStateEl: HTMLElement | null;
  private readonly selectedStateInfoWrapEl: HTMLElement | null;
  private readonly selectedStateInfoTooltipEl: HTMLElement | null;
  private readonly selectedMetaEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly leaderboardEl: HTMLElement | null;
  private readonly playButton: HTMLButtonElement | null;
  private readonly playCourseButton: HTMLButtonElement | null;
  private readonly courseBuilderButton: HTMLButtonElement | null;
  private readonly editButton: HTMLButtonElement | null;
  private readonly buildButton: HTMLButtonElement | null;
  private readonly jumpInput: HTMLInputElement | null;
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
  private readonly mobileGoalFooterEl: HTMLElement | null;
  private readonly mobileGoalFooterGoalEl: HTMLElement | null;
  private readonly mobileGoalFooterProgressEl: HTMLElement | null;
  private readonly mobileGoalFooterTimerEl: HTMLElement | null;
  private destroyed = false;
  private playersOnlinePinned = false;
  private selectedCreatorUserId: string | null = null;

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

  constructor(private readonly doc: Document = document) {
    this.hudRoot = this.doc.getElementById('world-hud');
    this.selectedTitleEl = this.doc.getElementById('world-selected-title');
    this.selectedCreatorEl = this.doc.getElementById('world-selected-coords') as HTMLButtonElement | null;
    this.selectedStateEl = this.doc.getElementById('world-selected-state');
    this.selectedStateInfoWrapEl = this.doc.getElementById('world-selected-state-info-wrap');
    this.selectedStateInfoTooltipEl = this.doc.getElementById('world-selected-state-info-tooltip');
    this.selectedMetaEl = this.doc.getElementById('world-selected-meta');
    this.statusEl = this.doc.getElementById('world-status');
    this.leaderboardEl = this.doc.getElementById('world-leaderboard');
    this.playButton = this.doc.getElementById('btn-world-play') as HTMLButtonElement | null;
    this.playCourseButton = this.doc.getElementById('btn-world-play-course') as HTMLButtonElement | null;
    this.courseBuilderButton = this.doc.getElementById('btn-world-course-builder') as HTMLButtonElement | null;
    this.editButton = this.doc.getElementById('btn-world-edit') as HTMLButtonElement | null;
    this.buildButton = this.doc.getElementById('btn-world-build') as HTMLButtonElement | null;
    this.jumpInput = this.doc.getElementById('world-jump-input') as HTMLInputElement | null;
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
    this.mobileGoalFooterEl = this.doc.getElementById('mobile-goal-footer');
    this.mobileGoalFooterGoalEl = this.doc.getElementById('mobile-goal-footer-goal');
    this.mobileGoalFooterProgressEl = this.doc.getElementById('mobile-goal-footer-progress');
    this.mobileGoalFooterTimerEl = this.doc.getElementById('mobile-goal-footer-timer');

    this.playersOnlineWrapEl?.addEventListener('pointerenter', this.handlePlayersOnlinePointerEnter);
    this.playersOnlineWrapEl?.addEventListener('pointerleave', this.handlePlayersOnlinePointerLeave);
    this.playersOnlineWrapEl?.addEventListener('focusin', this.handlePlayersOnlineFocusIn);
    this.playersOnlineWrapEl?.addEventListener('focusout', this.handlePlayersOnlineFocusOut);
    this.playersOnlineEl?.addEventListener('click', this.handlePlayersOnlineClick);
    this.selectedCreatorEl?.addEventListener('click', this.handleSelectedCreatorClick);
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
    this.renderSelectedCreator(viewModel.selectedCreatorText, viewModel.selectedCreatorUserId);
    this.setText(this.selectedStateEl, viewModel.selectedStateText);
    this.setStateTone(viewModel.selectedStateTone);
    this.renderSelectedStateInfo(viewModel.selectedStateInfoVisible, viewModel.selectedStateInfoText);
    this.setText(this.selectedMetaEl, viewModel.selectedMetaText);
    this.setMetaTone(viewModel.selectedMetaTone);
    this.setText(this.statusEl, viewModel.statusText);
    this.setText(this.leaderboardEl, viewModel.leaderboardText);
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
    this.setButton(
      this.playCourseButton,
      viewModel.playCourseButtonText,
      viewModel.playCourseButtonDisabled
    );
    this.setActive(this.playCourseButton, viewModel.playCourseButtonActive);
    this.playCourseButton?.classList.toggle('hidden', viewModel.playCourseButtonHidden);
    this.setDisabled(this.courseBuilderButton, viewModel.courseBuilderButtonDisabled);
    this.setTitle(this.courseBuilderButton, viewModel.courseBuilderButtonTitle);
    this.setDisabled(this.editButton, viewModel.editButtonDisabled);
    this.setTitle(this.editButton, viewModel.editButtonTitle);
    this.setDisabled(this.buildButton, viewModel.buildButtonDisabled);
    this.renderGoalPanel(viewModel);
  }

  destroy(): void {
    this.destroyed = true;
    this.playersOnlineWrapEl?.removeEventListener('pointerenter', this.handlePlayersOnlinePointerEnter);
    this.playersOnlineWrapEl?.removeEventListener('pointerleave', this.handlePlayersOnlinePointerLeave);
    this.playersOnlineWrapEl?.removeEventListener('focusin', this.handlePlayersOnlineFocusIn);
    this.playersOnlineWrapEl?.removeEventListener('focusout', this.handlePlayersOnlineFocusOut);
    this.playersOnlineEl?.removeEventListener('click', this.handlePlayersOnlineClick);
    this.selectedCreatorEl?.removeEventListener('click', this.handleSelectedCreatorClick);
    this.doc.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.doc.removeEventListener('keydown', this.handleDocumentKeyDown, true);
  }

  private setText(element: HTMLElement | null, text: string): void {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
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
      this.setPlayersOnlinePopoverOpen(false);
      return;
    }

    if (this.playersOnlinePopoverEmptyEl) {
      this.playersOnlinePopoverEmptyEl.classList.toggle('hidden', viewModel.playersOnlineEntries.length > 0);
    }

    if (this.playersOnlinePopoverListEl) {
      this.playersOnlinePopoverListEl.replaceChildren(
        ...viewModel.playersOnlineEntries.map((entry) => this.createPlayersOnlineEntry(entry))
      );
    }
  }

  private createPlayersOnlineEntry(entry: OverworldOnlineRosterViewEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'world-online-popover-entry';
    row.dataset.onlineKey = entry.key;

    const name = createProfileTriggerElement(
      this.doc,
      entry.userId,
      entry.isSelf ? `${entry.displayName} (You)` : entry.displayName,
      'world-online-popover-entry-name',
      'div'
    );
    name.dataset.onlineSelf = entry.isSelf ? 'true' : 'false';

    const room = this.doc.createElement('div');
    room.className = 'world-online-popover-room';
    room.textContent = entry.roomText;

    row.append(name, room);
    return row;
  }

  private renderSelectedCreator(text: string, userId: string | null): void {
    if (!this.selectedCreatorEl) {
      return;
    }

    this.selectedCreatorUserId = userId;
    this.selectedCreatorEl.textContent = text;
    const clickable = isOpenableProfileUserId(userId);
    this.selectedCreatorEl.disabled = !clickable;
    this.selectedCreatorEl.classList.toggle('is-clickable', clickable);
    this.selectedCreatorEl.title = clickable ? `View ${text.replace(/^by\s+/i, '')}'s profile` : '';
  }

  private renderSelectedStateInfo(visible: boolean, text: string): void {
    this.selectedStateInfoWrapEl?.classList.toggle('hidden', !visible);
    this.setText(this.selectedStateInfoTooltipEl, text);
  }

  private canShowPlayersOnlinePopover(): boolean {
    return Boolean(this.playersOnlineWrapEl && !this.playersOnlineWrapEl.classList.contains('hidden'));
  }

  private setPlayersOnlinePopoverOpen(open: boolean): void {
    this.playersOnlineWrapEl?.classList.toggle('is-open', open);
    this.playersOnlinePopoverEl?.classList.toggle('hidden', !open);
    this.playersOnlinePopoverEl?.setAttribute('aria-hidden', open ? 'false' : 'true');
    this.playersOnlineEl?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  private renderGoalPanel(viewModel: OverworldHudViewModel): void {
    if (!this.goalPanelEl) {
      this.renderMobileGoalFooter(viewModel);
      return;
    }

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
}
