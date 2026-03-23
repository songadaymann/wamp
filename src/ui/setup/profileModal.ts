import Phaser from 'phaser';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  refreshAuthSession,
  type AuthDebugState,
} from '../../auth/client';
import type { ProfilePublishedRoomEntry, ProfileStatsSummary, UserProfileResponse } from '../../profiles/model';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import { getActiveOverworldScene } from './sceneBridge';
import { PROFILE_OPEN_REQUEST_EVENT, type ProfileOpenRequestDetail } from './profileEvents';

type ProfileTabId = 'overview' | 'rooms' | 'stats';

type ProfileModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  meta: HTMLElement | null;
  error: HTMLElement | null;
  title: HTMLElement | null;
  avatarImage: HTMLImageElement | null;
  avatarFallback: HTMLElement | null;
  displayName: HTMLElement | null;
  joinedDate: HTMLElement | null;
  overviewBio: HTMLElement | null;
  overviewStats: HTMLElement | null;
  editFields: HTMLElement | null;
  displayNameInput: HTMLInputElement | null;
  avatarUrlInput: HTMLInputElement | null;
  bioInput: HTMLTextAreaElement | null;
  saveButton: HTMLButtonElement | null;
  saveStatus: HTMLElement | null;
  tabButtons: Record<ProfileTabId, HTMLButtonElement | null>;
  panels: Record<ProfileTabId, HTMLElement | null>;
  roomsList: HTMLElement | null;
  roomsEmpty: HTMLElement | null;
  statsList: HTMLElement | null;
};

export class ProfileModalController {
  private readonly elements: ProfileModalElements;
  private readonly profileCache = new Map<string, UserProfileResponse>();
  private authState: AuthDebugState = getAuthDebugState();
  private activeTab: ProfileTabId = 'overview';
  private currentProfileUserId: string | null = null;
  private currentProfile: UserProfileResponse | null = null;
  private loading = false;
  private saving = false;
  private avatarPreviewBroken = false;
  private loadToken = 0;

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close();
  };

  private readonly handleProfileOpenRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as ProfileOpenRequestDetail | undefined)
        : undefined;
    if (!detail?.userId) {
      return;
    }

    void this.open(detail.userId);
  };

  private readonly handleAuthStateChanged = (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as AuthDebugState | undefined) : undefined;
    this.authState = detail ?? getAuthDebugState();
    if (this.currentProfile && this.currentProfile.userId === this.authState.user?.id) {
      this.currentProfile.isSelf = true;
      this.currentProfile.canEdit = true;
    }
    this.render();
  };

  private readonly handleAvatarImageError = () => {
    this.avatarPreviewBroken = true;
    this.renderAvatar();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly profileRepository: ProfileRepository = createProfileRepository(),
    private readonly doc: Document = document,
    private readonly windowObj: Window = window
  ) {
    this.elements = {
      modal: this.doc.getElementById('profile-modal'),
      closeButton: this.doc.getElementById('btn-profile-close') as HTMLButtonElement | null,
      meta: this.doc.getElementById('profile-modal-meta'),
      error: this.doc.getElementById('profile-modal-error'),
      title: this.doc.getElementById('profile-modal-title'),
      avatarImage: this.doc.getElementById('profile-avatar-image') as HTMLImageElement | null,
      avatarFallback: this.doc.getElementById('profile-avatar-fallback'),
      displayName: this.doc.getElementById('profile-display-name'),
      joinedDate: this.doc.getElementById('profile-joined-date'),
      overviewBio: this.doc.getElementById('profile-overview-bio'),
      overviewStats: this.doc.getElementById('profile-overview-stats'),
      editFields: this.doc.getElementById('profile-edit-fields'),
      displayNameInput: this.doc.getElementById('profile-display-name-input') as HTMLInputElement | null,
      avatarUrlInput: this.doc.getElementById('profile-avatar-url-input') as HTMLInputElement | null,
      bioInput: this.doc.getElementById('profile-bio-input') as HTMLTextAreaElement | null,
      saveButton: this.doc.getElementById('btn-profile-save') as HTMLButtonElement | null,
      saveStatus: this.doc.getElementById('profile-save-status'),
      tabButtons: {
        overview: this.doc.getElementById('btn-profile-tab-overview') as HTMLButtonElement | null,
        rooms: this.doc.getElementById('btn-profile-tab-rooms') as HTMLButtonElement | null,
        stats: this.doc.getElementById('btn-profile-tab-stats') as HTMLButtonElement | null,
      },
      panels: {
        overview: this.doc.getElementById('profile-overview-panel'),
        rooms: this.doc.getElementById('profile-rooms-panel'),
        stats: this.doc.getElementById('profile-stats-panel'),
      },
      roomsList: this.doc.getElementById('profile-rooms-list'),
      roomsEmpty: this.doc.getElementById('profile-rooms-empty'),
      statsList: this.doc.getElementById('profile-stats-list'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(PROFILE_OPEN_REQUEST_EVENT, this.handleProfileOpenRequest as EventListener);
    this.windowObj.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.elements.avatarImage?.addEventListener('error', this.handleAvatarImageError);
    this.elements.saveButton?.addEventListener('click', () => {
      void this.saveProfile();
    });
    this.elements.displayNameInput?.addEventListener('input', () => {
      this.renderAvatar();
    });
    this.elements.avatarUrlInput?.addEventListener('input', () => {
      this.avatarPreviewBroken = false;
      this.renderAvatar();
    });
    for (const [tabId, button] of Object.entries(this.elements.tabButtons) as Array<
      [ProfileTabId, HTMLButtonElement | null]
    >) {
      button?.addEventListener('click', () => {
        this.activeTab = tabId;
        this.renderTabs();
      });
    }
  }

  async open(userId: string): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.currentProfileUserId = userId;
    this.activeTab = 'overview';
    this.loading = true;
    this.avatarPreviewBroken = false;
    this.setError(null);
    this.setSaveStatus('');
    this.currentProfile = null;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');

    const cached = this.profileCache.get(userId);
    if (cached) {
      this.currentProfile = cached;
      this.loading = false;
    }

    this.render();

    const loadToken = ++this.loadToken;
    try {
      const profile = await this.profileRepository.loadProfile(userId);
      if (loadToken !== this.loadToken || this.currentProfileUserId !== userId) {
        return;
      }

      this.profileCache.set(userId, profile);
      this.currentProfile = profile;
      this.loading = false;
      this.render();
    } catch (error) {
      if (loadToken !== this.loadToken || this.currentProfileUserId !== userId) {
        return;
      }

      this.loading = false;
      this.currentProfile = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load profile.');
      this.render();
    }
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.currentProfileUserId = null;
    this.currentProfile = null;
    this.loading = false;
    this.saving = false;
    this.avatarPreviewBroken = false;
    this.setError(null);
    this.setSaveStatus('');
  }

  private async saveProfile(): Promise<void> {
    if (!this.currentProfile?.canEdit || this.saving) {
      return;
    }

    const displayName = this.elements.displayNameInput?.value.trim() ?? '';
    const avatarUrl = this.elements.avatarUrlInput?.value.trim() || null;
    const bio = this.elements.bioInput?.value ?? '';

    this.saving = true;
    this.setSaveStatus('Saving profile...');
    this.setError(null);
    this.render();

    try {
      const response = await this.profileRepository.updateMyProfile({
        displayName,
        avatarUrl,
        bio,
      });
      this.profileCache.set(response.profile.userId, response.profile);
      this.currentProfile = response.profile;
      this.avatarPreviewBroken = false;
      await refreshAuthSession();
      this.setSaveStatus('Profile saved.');
    } catch (error) {
      this.setSaveStatus('');
      this.setError(error instanceof Error ? error.message : 'Failed to save profile.');
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.elements.modal || this.elements.modal.classList.contains('hidden')) {
      return;
    }

    const profile = this.currentProfile;
    const titleText = this.loading
      ? 'Loading profile...'
      : profile
        ? profile.displayName
        : 'Profile';
    if (this.elements.title) {
      this.elements.title.textContent = titleText;
    }

    if (this.elements.meta) {
      this.elements.meta.textContent = this.loading
        ? 'Loading public profile, rooms, and stats.'
        : profile
          ? profile.isSelf
            ? 'Edit your public profile.'
            : 'View creator profile, rooms, and stats.'
          : 'Profile unavailable.';
    }

    if (this.elements.displayName) {
      this.elements.displayName.textContent = profile?.displayName ?? 'Unknown player';
    }

    if (this.elements.joinedDate) {
      this.elements.joinedDate.textContent = profile?.createdAt
        ? `Joined ${this.formatLongDate(profile.createdAt)}`
        : '';
    }

    if (this.elements.editFields) {
      this.elements.editFields.classList.toggle('hidden', !profile?.canEdit);
    }

    if (this.elements.displayNameInput && profile?.canEdit) {
      if (this.doc.activeElement !== this.elements.displayNameInput) {
        this.elements.displayNameInput.value = profile.displayName;
      }
      this.elements.displayNameInput.disabled = this.saving;
    }

    if (this.elements.avatarUrlInput && profile?.canEdit) {
      if (this.doc.activeElement !== this.elements.avatarUrlInput) {
        this.elements.avatarUrlInput.value = profile.avatarUrl ?? '';
      }
      this.elements.avatarUrlInput.disabled = this.saving;
    }

    if (this.elements.bioInput && profile?.canEdit) {
      if (this.doc.activeElement !== this.elements.bioInput) {
        this.elements.bioInput.value = profile.bio ?? '';
      }
      this.elements.bioInput.disabled = this.saving;
    }

    if (this.elements.saveButton) {
      this.elements.saveButton.classList.toggle('hidden', !profile?.canEdit);
      this.elements.saveButton.disabled = this.saving || !profile?.canEdit;
      this.elements.saveButton.textContent = this.saving ? 'Saving...' : 'Save Profile';
    }

    if (this.elements.overviewBio) {
      this.elements.overviewBio.textContent = profile?.bio?.trim() || 'No bio yet.';
      this.elements.overviewBio.classList.toggle('profile-overview-bio-empty', !profile?.bio?.trim());
    }

    this.renderAvatar();
    this.renderOverviewStats(profile?.stats ?? null, profile?.publishedCourseCount ?? 0);
    this.renderRooms(profile?.publishedRooms ?? []);
    this.renderStats(profile?.stats ?? null, profile?.publishedCourseCount ?? 0);
    this.renderTabs();
  }

  private renderAvatar(): void {
    const profile = this.currentProfile;
    const nameDraft =
      this.currentProfile?.canEdit
        ? this.elements.displayNameInput?.value.trim() || profile?.displayName || 'Profile'
        : profile?.displayName || 'Profile';
    const avatarUrl =
      this.currentProfile?.canEdit
        ? this.elements.avatarUrlInput?.value.trim() || profile?.avatarUrl || ''
        : profile?.avatarUrl || '';

    if (this.elements.avatarFallback) {
      this.elements.avatarFallback.textContent = initialsFromDisplayName(nameDraft);
    }

    const canShowImage = Boolean(avatarUrl) && !this.avatarPreviewBroken;
    this.elements.avatarImage?.classList.toggle('hidden', !canShowImage);
    this.elements.avatarFallback?.classList.toggle('hidden', canShowImage);

    if (this.elements.avatarImage && canShowImage && this.elements.avatarImage.src !== avatarUrl) {
      this.elements.avatarImage.src = avatarUrl;
      this.elements.avatarImage.alt = `${nameDraft} avatar`;
    }
  }

  private renderOverviewStats(stats: ProfileStatsSummary | null, publishedCourseCount: number): void {
    if (!this.elements.overviewStats) {
      return;
    }

    const entries = [
      ['Points', String(stats?.totalPoints ?? 0)],
      ['Score', String(stats?.totalScore ?? 0)],
      ['Rooms', String(stats?.totalRoomsPublished ?? 0)],
      ['Clears', String(stats?.completedRuns ?? 0)],
      ['Courses', String(publishedCourseCount)],
      ['Rank', stats?.globalRank ? `#${stats.globalRank}` : 'Unranked'],
    ];

    this.elements.overviewStats.replaceChildren(
      ...entries.map(([label, value]) => {
        const chip = this.doc.createElement('div');
        chip.className = 'profile-stat-chip';
        const labelEl = this.doc.createElement('div');
        labelEl.className = 'profile-stat-chip-label';
        labelEl.textContent = label;
        const valueEl = this.doc.createElement('div');
        valueEl.className = 'profile-stat-chip-value';
        valueEl.textContent = value;
        chip.append(labelEl, valueEl);
        return chip;
      })
    );
  }

  private renderRooms(rooms: ProfilePublishedRoomEntry[]): void {
    if (!this.elements.roomsList) {
      return;
    }

    this.elements.roomsEmpty?.classList.toggle('hidden', rooms.length > 0);
    this.elements.roomsList.replaceChildren(
      ...rooms.map((room) => this.createRoomRow(room))
    );
  }

  private createRoomRow(room: ProfilePublishedRoomEntry): HTMLElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'leaderboard-discover-row profile-room-row';
    button.addEventListener('click', () => {
      this.close();
      void getActiveOverworldScene(this.game)?.jumpToCoordinates?.(room.roomCoordinates);
    });

    const title = this.doc.createElement('div');
    title.className = 'leaderboard-discover-title';
    title.textContent =
      room.roomTitle?.trim() || `Room ${room.roomCoordinates.x},${room.roomCoordinates.y}`;

    const meta = this.doc.createElement('div');
    meta.className = 'leaderboard-discover-meta';
    const goalText = room.goalType ? room.goalType.replace(/_/g, ' ') : 'free play';
    const publishedText = room.publishedAt ? this.formatShortDate(room.publishedAt) : 'Unpublished';
    meta.textContent = `${goalText} · v${room.roomVersion} · ${room.roomCoordinates.x},${room.roomCoordinates.y} · ${publishedText}`;

    button.append(title, meta);
    return button;
  }

  private renderStats(stats: ProfileStatsSummary | null, publishedCourseCount: number): void {
    if (!this.elements.statsList) {
      return;
    }

    const items: Array<[string, string]> = [
      ['Total points', String(stats?.totalPoints ?? 0)],
      ['Total score', String(stats?.totalScore ?? 0)],
      ['Rooms published', String(stats?.totalRoomsPublished ?? 0)],
      ['Published courses', String(publishedCourseCount)],
      ['Completed runs', String(stats?.completedRuns ?? 0)],
      ['Failed runs', String(stats?.failedRuns ?? 0)],
      ['Abandoned runs', String(stats?.abandonedRuns ?? 0)],
      ['Best score', String(stats?.bestScore ?? 0)],
      ['Fastest clear', stats?.fastestClearMs ? formatDuration(stats.fastestClearMs) : 'None yet'],
      ['Global rank', stats?.globalRank ? `#${stats.globalRank}` : 'Unranked'],
      ['Collectibles', String(stats?.totalCollectibles ?? 0)],
      ['Enemies defeated', String(stats?.totalEnemiesDefeated ?? 0)],
      ['Checkpoints', String(stats?.totalCheckpoints ?? 0)],
      ['Deaths', String(stats?.totalDeaths ?? 0)],
    ];

    this.elements.statsList.replaceChildren(
      ...items.map(([label, value]) => {
        const row = this.doc.createElement('div');
        row.className = 'profile-stats-row';
        const labelEl = this.doc.createElement('div');
        labelEl.className = 'profile-stats-label';
        labelEl.textContent = label;
        const valueEl = this.doc.createElement('div');
        valueEl.className = 'profile-stats-value';
        valueEl.textContent = value;
        row.append(labelEl, valueEl);
        return row;
      })
    );
  }

  private renderTabs(): void {
    for (const [tabId, button] of Object.entries(this.elements.tabButtons) as Array<
      [ProfileTabId, HTMLButtonElement | null]
    >) {
      button?.classList.toggle('active', tabId === this.activeTab);
      button?.setAttribute('aria-selected', tabId === this.activeTab ? 'true' : 'false');
    }

    for (const [tabId, panel] of Object.entries(this.elements.panels) as Array<
      [ProfileTabId, HTMLElement | null]
    >) {
      panel?.classList.toggle('hidden', tabId !== this.activeTab);
    }
  }

  private setError(message: string | null): void {
    if (!this.elements.error) {
      return;
    }

    this.elements.error.textContent = message ?? '';
    this.elements.error.classList.toggle('hidden', !message);
  }

  private setSaveStatus(message: string): void {
    if (!this.elements.saveStatus) {
      return;
    }

    this.elements.saveStatus.textContent = message;
    this.elements.saveStatus.classList.toggle('hidden', !message);
  }

  private formatLongDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  }

  private formatShortDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  }
}

function initialsFromDisplayName(displayName: string): string {
  const parts = displayName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0.00s';
  }

  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((milliseconds % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}
