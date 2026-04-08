import Phaser from 'phaser';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  refreshAuthSession,
  type AuthDebugState,
} from '../../auth/client';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { createWorldRepository, type WorldRepository } from '../../persistence/worldRepository';
import type { ProfilePublishedRoomEntry, ProfileStatsSummary, UserProfileResponse } from '../../profiles/model';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import type { ProgressionLaneSummary, ProgressionSummary } from '../../progression/model';
import { getActiveOverworldScene } from './sceneBridge';
import {
  PROFILE_INVALIDATED_EVENT,
  PROFILE_OPEN_REQUEST_EVENT,
  type ProfileInvalidatedDetail,
  type ProfileOpenRequestDetail,
} from './profileEvents';

type ProfileTabId = 'rooms' | 'progress' | 'stats';

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
  heroLanes: HTMLElement | null;
  heroProgress: HTMLElement | null;
  overviewBio: HTMLElement | null;
  editFields: HTMLElement | null;
  displayNameInput: HTMLInputElement | null;
  bioInput: HTMLTextAreaElement | null;
  saveButton: HTMLButtonElement | null;
  saveStatus: HTMLElement | null;
  tabButtons: Record<ProfileTabId, HTMLButtonElement | null>;
  panels: Record<ProfileTabId, HTMLElement | null>;
  roomsList: HTMLElement | null;
  roomsEmpty: HTMLElement | null;
  progressList: HTMLElement | null;
  statsList: HTMLElement | null;
};

type ProfileTone = 'player' | 'builder' | 'curator';

const PROFILE_DEFAULT_AVATAR_SRC = '/assets/ui-creator-idle-tight.png';

const PROFILE_LANE_VISUALS: Record<
  ProfileTone,
  { iconSrc: string; iconLabel: string; fillClass: string }
> = {
  player: {
    iconSrc: '/assets/ui-progress-player.png',
    iconLabel: 'Player',
    fillClass: 'profile-hero-lane-fill-player',
  },
  builder: {
    iconSrc: '/assets/ui-progress-builder.png',
    iconLabel: 'Builder',
    fillClass: 'profile-hero-lane-fill-builder',
  },
  curator: {
    iconSrc: '/assets/ui-progress-curator.png',
    iconLabel: 'Curator',
    fillClass: 'profile-hero-lane-fill-curator',
  },
};

type ProfileInfoItem = {
  label: string;
  value: string;
  iconSrc?: string;
};

type ProfileInfoCard = {
  tone: ProfileTone;
  title: string;
  items: ProfileInfoItem[];
};

export class ProfileModalController {
  private readonly elements: ProfileModalElements;
  private readonly profileCache = new Map<string, UserProfileResponse>();
  private readonly roomPreviewCache = new Map<string, string | null>();
  private readonly roomPreviewLoads = new Map<string, Promise<string | null>>();
  private authState: AuthDebugState = getAuthDebugState();
  private activeTab: ProfileTabId = 'rooms';
  private currentProfileUserId: string | null = null;
  private currentProfile: UserProfileResponse | null = null;
  private loading = false;
  private saving = false;
  private avatarPreviewBroken = false;
  private loadToken = 0;
  private activeTabAutoSelected = false;

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

  private readonly handleProfileInvalidated = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as ProfileInvalidatedDetail | undefined)
        : undefined;
    if (!detail?.userId) {
      return;
    }

    this.profileCache.delete(detail.userId);
    if (this.currentProfileUserId === detail.userId && !this.loading) {
      void this.open(detail.userId);
    }
  };

  private readonly handleAvatarImageError = () => {
    this.avatarPreviewBroken = true;
    this.renderAvatar();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly profileRepository: ProfileRepository = createProfileRepository(),
    private readonly worldRepository: WorldRepository = createWorldRepository(),
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
      heroLanes: this.doc.getElementById('profile-hero-lanes'),
      heroProgress: this.doc.getElementById('profile-hero-progress'),
      overviewBio: this.doc.getElementById('profile-overview-bio'),
      editFields: this.doc.getElementById('profile-edit-fields'),
      displayNameInput: this.doc.getElementById('profile-display-name-input') as HTMLInputElement | null,
      bioInput: this.doc.getElementById('profile-bio-input') as HTMLTextAreaElement | null,
      saveButton: this.doc.getElementById('btn-profile-save') as HTMLButtonElement | null,
      saveStatus: this.doc.getElementById('profile-save-status'),
      tabButtons: {
        rooms: this.doc.getElementById('btn-profile-tab-rooms') as HTMLButtonElement | null,
        progress: this.doc.getElementById('btn-profile-tab-progress') as HTMLButtonElement | null,
        stats: this.doc.getElementById('btn-profile-tab-stats') as HTMLButtonElement | null,
      },
      panels: {
        rooms: this.doc.getElementById('profile-rooms-panel'),
        progress: this.doc.getElementById('profile-progress-panel'),
        stats: this.doc.getElementById('profile-stats-panel'),
      },
      roomsList: this.doc.getElementById('profile-rooms-list'),
      roomsEmpty: this.doc.getElementById('profile-rooms-empty'),
      progressList: this.doc.getElementById('profile-progress-list'),
      statsList: this.doc.getElementById('profile-stats-list'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(PROFILE_OPEN_REQUEST_EVENT, this.handleProfileOpenRequest as EventListener);
    this.windowObj.addEventListener(PROFILE_INVALIDATED_EVENT, this.handleProfileInvalidated as EventListener);
    this.windowObj.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.elements.avatarImage?.addEventListener('error', this.handleAvatarImageError);
    this.elements.saveButton?.addEventListener('click', () => {
      void this.saveProfile();
    });
    this.elements.displayNameInput?.addEventListener('input', () => {
      this.renderAvatar();
    });
    for (const [tabId, button] of Object.entries(this.elements.tabButtons) as Array<
      [ProfileTabId, HTMLButtonElement | null]
    >) {
      button?.addEventListener('click', () => {
        this.activeTab = tabId;
        this.activeTabAutoSelected = true;
        this.renderTabs();
      });
    }
  }

  async open(userId: string): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.currentProfileUserId = userId;
    this.activeTab = 'rooms';
    this.activeTabAutoSelected = false;
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
      this.selectDefaultTab(cached);
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
      this.selectDefaultTab(profile);
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
    const bio = this.elements.bioInput?.value ?? '';

    this.saving = true;
    this.setSaveStatus('Saving profile...');
    this.setError(null);
    this.render();

    try {
      const response = await this.profileRepository.updateMyProfile({
        displayName,
        avatarUrl: null,
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
          ? ''
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
    this.renderRooms(profile?.publishedRooms ?? []);
    this.renderProgress(profile?.progression ?? null);
    this.renderStats(profile?.stats ?? null, profile?.publishedCourseCount ?? 0);
    this.renderTabs();
  }

  private renderAvatar(): void {
    const profile = this.currentProfile;
    const nameDraft =
      this.currentProfile?.canEdit
        ? this.elements.displayNameInput?.value.trim() || profile?.displayName || 'Profile'
        : profile?.displayName || 'Profile';

    if (this.elements.avatarFallback) {
      this.elements.avatarFallback.textContent = initialsFromDisplayName(nameDraft);
    }

    const canShowImage = !this.avatarPreviewBroken;
    this.elements.avatarImage?.classList.toggle('hidden', !canShowImage);
    this.elements.avatarFallback?.classList.toggle('hidden', canShowImage);

    if (this.elements.avatarImage && canShowImage && this.elements.avatarImage.src !== PROFILE_DEFAULT_AVATAR_SRC) {
      this.elements.avatarImage.src = PROFILE_DEFAULT_AVATAR_SRC;
      this.elements.avatarImage.alt = `${nameDraft} avatar`;
    }
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
    button.className = 'profile-room-card';
    button.addEventListener('click', () => {
      this.close();
      void getActiveOverworldScene(this.game)?.jumpToCoordinates?.(room.roomCoordinates);
    });

    const preview = this.doc.createElement('div');
    preview.className = 'profile-room-preview';

    const previewImage = this.doc.createElement('img');
    previewImage.className = 'profile-room-preview-image hidden';
    previewImage.alt = `${room.roomTitle?.trim() || `Room ${room.roomCoordinates.x},${room.roomCoordinates.y}`} preview`;

    const previewFallback = this.doc.createElement('div');
    previewFallback.className = 'profile-room-preview-fallback';
    previewFallback.textContent = `${room.roomCoordinates.x},${room.roomCoordinates.y}`;

    preview.append(previewImage, previewFallback);

    const copy = this.doc.createElement('div');
    copy.className = 'profile-room-card-copy';

    const title = this.doc.createElement('div');
    title.className = 'profile-room-card-title';
    title.textContent =
      room.roomTitle?.trim() || `Room ${room.roomCoordinates.x},${room.roomCoordinates.y}`;

    const meta = this.doc.createElement('div');
    meta.className = 'profile-room-card-meta';
    const goalText = room.goalType ? room.goalType.replace(/_/g, ' ') : 'free play';
    const publishedText = room.publishedAt ? this.formatShortDate(room.publishedAt) : 'Unpublished';
    meta.textContent = `${goalText} · v${room.roomVersion} · ${room.roomCoordinates.x},${room.roomCoordinates.y} · ${publishedText}`;

    copy.append(title, meta);
    button.append(preview, copy);
    this.attachRoomPreview(room, previewImage, previewFallback);
    return button;
  }

  private attachRoomPreview(
    room: ProfilePublishedRoomEntry,
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement
  ): void {
    const previewKey = this.buildRoomPreviewKey(room);
    imageEl.dataset.previewKey = previewKey;

    const cached = this.roomPreviewCache.get(previewKey);
    if (cached !== undefined) {
      this.applyRoomPreview(imageEl, fallbackEl, cached, room);
      return;
    }

    fallbackEl.textContent = 'Loading preview...';
    imageEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');

    void this.loadRoomPreview(room).then((dataUrl) => {
      if (!imageEl.isConnected || imageEl.dataset.previewKey !== previewKey) {
        return;
      }

      this.applyRoomPreview(imageEl, fallbackEl, dataUrl, room);
    });
  }

  private applyRoomPreview(
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
    dataUrl: string | null,
    room: ProfilePublishedRoomEntry
  ): void {
    if (dataUrl) {
      imageEl.src = dataUrl;
      imageEl.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
      return;
    }

    fallbackEl.textContent = room.roomTitle?.trim() || `${room.roomCoordinates.x},${room.roomCoordinates.y}`;
    imageEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');
  }

  private loadRoomPreview(room: ProfilePublishedRoomEntry): Promise<string | null> {
    const previewKey = this.buildRoomPreviewKey(room);
    const inFlight = this.roomPreviewLoads.get(previewKey);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        const snapshot = await this.worldRepository.loadPublishedRoom(room.roomId, room.roomCoordinates);
        if (!snapshot) {
          this.roomPreviewCache.set(previewKey, null);
          return null;
        }

        const dataUrl = await renderRoomSnapshotToPngDataUrl(snapshot, {
          tilePixelSize: 4,
        });
        this.roomPreviewCache.set(previewKey, dataUrl);
        return dataUrl;
      } catch (error) {
        console.warn('Failed to load profile room preview.', room.roomId, error);
        this.roomPreviewCache.set(previewKey, null);
        return null;
      } finally {
        this.roomPreviewLoads.delete(previewKey);
      }
    })();

    this.roomPreviewLoads.set(previewKey, request);
    return request;
  }

  private buildRoomPreviewKey(room: ProfilePublishedRoomEntry): string {
    return `${room.roomId}:${room.roomVersion}`;
  }

  private renderStats(stats: ProfileStatsSummary | null, publishedCourseCount: number): void {
    if (!this.elements.statsList) {
      return;
    }

    if (!stats) {
      this.elements.statsList.replaceChildren(
        this.createInfoCard({
          tone: 'curator',
          title: 'Stats',
          items: [{ label: 'Status', value: 'No stats yet.' }],
        }),
      );
      return;
    }

    const cards: ProfileInfoCard[] = [
      {
        tone: 'player',
        title: 'Runs',
        items: [
          {
            label: 'Completed',
            value: String(stats.completedRuns),
            iconSrc: '/assets/ui-progress-player.png',
          },
          {
            label: 'Failed',
            value: String(stats.failedRuns),
            iconSrc: '/assets/enemies/saw.png',
          },
          {
            label: 'Abandoned',
            value: String(stats.abandonedRuns),
            iconSrc: '/assets/objects/sign_arrow.png',
          },
          {
            label: 'Best score',
            value: String(stats.bestScore),
            iconSrc: '/assets/objects/flag-checkered-gold.png',
          },
          {
            label: 'Fastest clear',
            value: stats.fastestClearMs ? formatDuration(stats.fastestClearMs) : 'None yet',
            iconSrc: '/assets/objects/flag-checkered.png',
          },
        ],
      },
      {
        tone: 'builder',
        title: 'Built',
        items: [
          {
            label: 'Rooms published',
            value: String(stats.totalRoomsPublished),
            iconSrc: '/assets/ui-progress-builder.png',
          },
          {
            label: 'Courses published',
            value: String(publishedCourseCount),
            iconSrc: '/assets/objects/flag-green.png',
          },
        ],
      },
      {
        tone: 'curator',
        title: 'World',
        items: [
          {
            label: 'Total points',
            value: String(stats.totalPoints),
            iconSrc: '/assets/ui-progress-curator.png',
          },
          {
            label: 'Global rank',
            value: stats.globalRank ? `#${stats.globalRank}` : 'Unranked',
            iconSrc: '/assets/objects/flag-checkered-gold.png',
          },
          {
            label: 'Collectibles',
            value: String(stats.totalCollectibles),
            iconSrc: '/assets/objects/coin_small_gold.png',
          },
          {
            label: 'Enemies',
            value: String(stats.totalEnemiesDefeated),
            iconSrc: '/assets/enemies/slime_red.png',
          },
          {
            label: 'Checkpoints',
            value: String(stats.totalCheckpoints),
            iconSrc: '/assets/objects/flag-green.png',
          },
          {
            label: 'Deaths',
            value: String(stats.totalDeaths),
            iconSrc: '/assets/enemies/saw.png',
          },
        ],
      },
    ];

    this.elements.statsList.replaceChildren(...cards.map((card) => this.createInfoCard(card)));
  }

  private renderProgress(progression: ProgressionSummary | null): void {
    if (this.elements.heroLanes) {
      if (!progression) {
        this.elements.heroLanes.replaceChildren();
      } else {
        this.elements.heroLanes.replaceChildren(
          this.createHeroLaneRow(progression.player, 'player'),
          this.createHeroLaneRow(progression.builder, 'builder'),
          this.createHeroLaneRow(progression.curator, 'curator'),
        );
      }
    }

    if (this.elements.heroProgress) {
      const chips: HTMLElement[] = [];
      if (progression && progression.founderNumber !== null) {
        chips.push(this.createHeroSummaryChip(`WAMP #${progression.founderNumber}`, 'curator'));
      }
      if (progression) {
        chips.push(this.createHeroSummaryChip(`${progression.badgeCount} ${pluralize('badge', progression.badgeCount)}`, 'builder'));
        chips.push(this.createHeroSummaryChip(`${progression.trophyCount} ${pluralize('trophy', progression.trophyCount)}`, 'player'));
      }
      this.elements.heroProgress.replaceChildren(...chips);
      this.elements.heroProgress.classList.toggle('hidden', chips.length === 0);
    }

    if (!this.elements.progressList) {
      return;
    }

    if (!progression) {
      this.elements.progressList.replaceChildren(
        this.createInfoCard({
          tone: 'curator',
          title: 'Progress',
          items: [{ label: 'Status', value: 'No progression data yet.' }],
        }),
      );
      return;
    }

    const milestoneItems: ProfileInfoItem[] = [];
    if (progression.builderCaps.overrideActive) {
      milestoneItems.push({
        label: 'Cap boost',
        value: 'Admin boost active',
        iconSrc: '/assets/ui-progress-builder.png',
      });
    }
    for (const badge of progression.featuredBadges.slice(0, 3)) {
      milestoneItems.push({
        label: badge.category,
        value: `${badge.label} · ${badge.description}`,
        iconSrc: '/assets/ui-progress-curator.png',
      });
    }
    for (const trophy of progression.recentTrophies.slice(0, 3)) {
      milestoneItems.push({
        label: 'Trophy',
        value: `${trophy.contentType} ${trophy.contentId} v${trophy.versionKey} · ${trophy.trophyType}`,
        iconSrc: '/assets/objects/flag-checkered-gold.png',
      });
    }

    const cards: ProfileInfoCard[] = [
      {
        tone: 'builder',
        title: 'Build Limits',
        items: [
          {
            label: 'Placed objects',
            value: String(progression.builderCaps.objectLimit),
            iconSrc: '/assets/ui-progress-builder.png',
          },
          {
            label: 'Collectibles',
            value: String(progression.builderCaps.collectibleLimit),
            iconSrc: '/assets/objects/coin_small_gold.png',
          },
        ],
      },
      {
        tone: 'builder',
        title: 'Daily Rhythm',
        items: [
          {
            label: 'Publish / day',
            value: String(progression.builderCaps.publishLimitPerDay),
            iconSrc: '/assets/objects/flag-green.png',
          },
          {
            label: 'Claim / day',
            value: String(progression.builderCaps.claimLimitPerDay),
            iconSrc: '/assets/objects/key.png',
          },
        ],
      },
    ];

    if (milestoneItems.length > 0) {
      cards.push({
        tone: 'curator',
        title: 'Milestones',
        items: milestoneItems,
      });
    }

    this.elements.progressList.replaceChildren(...cards.map((card) => this.createInfoCard(card)));
  }

  private selectDefaultTab(profile: UserProfileResponse): void {
    if (this.activeTabAutoSelected) {
      return;
    }

    this.activeTab = profile.isSelf ? 'progress' : 'rooms';
    this.activeTabAutoSelected = true;
  }

  private createHeroLaneRow(
    lane: ProgressionLaneSummary,
    tone: ProfileTone,
  ): HTMLElement {
    const visual = PROFILE_LANE_VISUALS[tone];
    const row = this.doc.createElement('div');
    row.className = `profile-hero-lane profile-hero-lane-${tone}`;

    const labelWrap = this.doc.createElement('div');
    labelWrap.className = 'profile-hero-lane-label-wrap';

    const icon = this.doc.createElement('img');
    icon.className = 'profile-hero-lane-icon';
    icon.src = visual.iconSrc;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');

    const label = this.doc.createElement('span');
    label.className = 'profile-hero-lane-label';
    label.textContent = `LVL ${lane.level}`;

    labelWrap.append(icon, label);

    const progress = this.doc.createElement('div');
    progress.className = 'profile-hero-lane-progress';

    const fill = this.doc.createElement('div');
    fill.className = `profile-hero-lane-fill ${visual.fillClass}`;
    fill.style.width = `${(Math.max(0, Math.min(1, lane.progressFraction)) * 100).toFixed(1)}%`;
    progress.appendChild(fill);

    const total = this.doc.createElement('span');
    total.className = 'profile-hero-lane-total';
    total.textContent = formatLaneTarget(lane);

    row.append(labelWrap, progress, total);
    row.setAttribute('aria-label', `${visual.iconLabel} level ${lane.level}, ${formatLaneTarget(lane)} to next level`);
    return row;
  }

  private createHeroSummaryChip(text: string, tone: ProfileTone): HTMLElement {
    const chip = this.doc.createElement('div');
    chip.className = `profile-hero-summary-chip profile-hero-summary-chip-${tone}`;
    chip.textContent = text;
    return chip;
  }

  private createInfoCard(card: ProfileInfoCard): HTMLElement {
    const visual = PROFILE_LANE_VISUALS[card.tone];
    const section = this.doc.createElement('section');
    section.className = `profile-info-card profile-info-card-${card.tone}`;

    const header = this.doc.createElement('div');
    header.className = 'profile-info-card-header';

    const icon = this.doc.createElement('img');
    icon.className = 'profile-info-card-header-icon';
    icon.src = visual.iconSrc;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');

    const title = this.doc.createElement('div');
    title.className = 'profile-info-card-title';
    title.textContent = card.title;

    header.append(icon, title);

    const grid = this.doc.createElement('div');
    grid.className = 'profile-info-card-grid';

    for (const item of card.items) {
      const row = this.doc.createElement('div');
      row.className = 'profile-info-item';

      if (item.iconSrc) {
        const rowIcon = this.doc.createElement('img');
        rowIcon.className = 'profile-info-item-icon';
        rowIcon.src = item.iconSrc;
        rowIcon.alt = '';
        rowIcon.setAttribute('aria-hidden', 'true');
        row.appendChild(rowIcon);
      }

      const copy = this.doc.createElement('div');
      copy.className = 'profile-info-item-copy';

      const label = this.doc.createElement('div');
      label.className = 'profile-info-item-label';
      label.textContent = item.label;

      const value = this.doc.createElement('div');
      value.className = 'profile-info-item-value';
      value.textContent = item.value;

      copy.append(label, value);
      row.appendChild(copy);
      grid.appendChild(row);
    }

    section.append(header, grid);
    return section;
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

function formatLaneTarget(lane: ProgressionLaneSummary): string {
  const span = Math.max(1, lane.nextLevelXp - lane.currentLevelStartXp);
  const current = Math.max(0, Math.min(span, lane.xp - lane.currentLevelStartXp));
  return `${current}/${span}`;
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}
