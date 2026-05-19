import Phaser from 'phaser';
import {
  getEffectiveCryptopunkViewerLevel,
  isCryptopunkUnlockOverrideEnabled,
} from '../../avatars/debug';
import { loadCryptopunkHeadPreviewUrl } from '../../avatars/headPreview';
import {
  CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
  parseCryptopunkAvatarId,
  type CryptopunkAvatarStatusResponse,
} from '../../avatars/model';
import { createAvatarRepository, type AvatarRepository } from '../../avatars/repository';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  refreshAuthSession,
  type AuthDebugState,
} from '../../auth/client';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { createWorldRepository, type WorldRepository } from '../../persistence/worldRepository';
import type { PlayerAvatarChoice } from '../../player/avatar/model';
import { createPlayerAvatarPreviewDataUrl } from '../../player/avatar/previews';
import { DEFAULT_PLAYER_AVATAR_ID } from '../../player/avatar/registry';
import { setStoredPlayerAvatarId } from '../../player/avatar/storage';
import { resolveSelectablePlayerAvatarId } from '../../player/avatar/unlocks';
import type { RoomPlaylistSummary } from '../../playlists/model';
import {
  buildPlaylistShareUrl,
  derivePlaylistSlugBase,
} from '../../playlists/model';
import { createPlaylistRepository, type PlaylistRepository } from '../../playlists/repository';
import type { ProfilePublishedRoomEntry, ProfileStatsSummary, UserProfileResponse } from '../../profiles/model';
import { createProfileRepository, type ProfileRepository } from '../../profiles/profileRepository';
import {
  buildProfileShareUrl,
  deriveProfileUsernameBase,
  parseProfileSharePath,
} from '../../profiles/username';
import type { ProgressionLaneSummary, ProgressionSummary } from '../../progression/model';
import { ROOM_DIFFICULTY_LABELS } from '../../runs/model';
import { getActiveOverworldScene } from './sceneBridge';
import {
  PROFILE_INVALIDATED_EVENT,
  PROFILE_OPEN_REQUEST_EVENT,
  type ProfileInvalidatedDetail,
  type ProfileOpenRequestDetail,
} from './profileEvents';
import { requestPlaylistOpen } from './playlistEvents';

type ProfileTabId = 'rooms' | 'playlists' | 'progress' | 'stats';

type ProfileModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  shareButton: HTMLButtonElement | null;
  meta: HTMLElement | null;
  error: HTMLElement | null;
  title: HTMLElement | null;
  avatarImage: HTMLImageElement | null;
  avatarFallback: HTMLElement | null;
  avatarChangeButton: HTMLButtonElement | null;
  avatarPickerModal: HTMLElement | null;
  avatarPickerCloseButton: HTMLButtonElement | null;
  avatarPickerGrid: HTMLElement | null;
  avatarPickerMeta: HTMLElement | null;
  cryptopunkUnlockMeta: HTMLElement | null;
  cryptopunkInput: HTMLInputElement | null;
  cryptopunkPreviewImage: HTMLImageElement | null;
  cryptopunkPreviewFallback: HTMLElement | null;
  cryptopunkStatus: HTMLElement | null;
  cryptopunkActionButton: HTMLButtonElement | null;
  displayName: HTMLElement | null;
  usernameDisplay: HTMLElement | null;
  joinedDate: HTMLElement | null;
  heroLanes: HTMLElement | null;
  heroProgress: HTMLElement | null;
  overviewBio: HTMLElement | null;
  editFields: HTMLElement | null;
  displayNameInput: HTMLInputElement | null;
  usernameInput: HTMLInputElement | null;
  bioInput: HTMLTextAreaElement | null;
  saveButton: HTMLButtonElement | null;
  saveStatus: HTMLElement | null;
  tabButtons: Record<ProfileTabId, HTMLButtonElement | null>;
  panels: Record<ProfileTabId, HTMLElement | null>;
  roomsList: HTMLElement | null;
  roomsEmpty: HTMLElement | null;
  playlistCreateFields: HTMLElement | null;
  playlistTitleInput: HTMLInputElement | null;
  playlistSlugInput: HTMLInputElement | null;
  playlistDescriptionInput: HTMLTextAreaElement | null;
  playlistCreateButton: HTMLButtonElement | null;
  playlistSelect: HTMLSelectElement | null;
  playlistStatus: HTMLElement | null;
  playlistsList: HTMLElement | null;
  playlistsEmpty: HTMLElement | null;
  progressList: HTMLElement | null;
  statsList: HTMLElement | null;
};

type ProfileTone = 'player' | 'builder' | 'curator';

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
  private selectedAvatarIdDraft = DEFAULT_PLAYER_AVATAR_ID;
  private cryptopunkPreviewBroken = false;
  private cryptopunkPreviewUrl: string | null = null;
  private cryptopunkPreviewPunkId: number | null = null;
  private cryptopunkStatusLoading = false;
  private cryptopunkActionInFlight = false;
  private cryptopunkStatus: CryptopunkAvatarStatusResponse | null = null;
  private cryptopunkSelectionStatus = '';
  private avatarPreviewToken = 0;
  private loadToken = 0;
  private cryptopunkPreviewLoadToken = 0;
  private cryptopunkLoadToken = 0;
  private cryptopunkPollTimer: number | null = null;
  private cryptopunkInputTimer: number | null = null;
  private activeTabAutoSelected = false;
  private selectedPlaylistId: string | null = null;
  private playlistBusy = false;
  private playlistStatus = '';

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleShareClick = () => {
    void this.shareCurrentProfile();
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleAvatarPickerBackdropClick = (event: Event) => {
    if (event.target === this.elements.avatarPickerModal) {
      this.closeAvatarPicker();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (!this.elements.avatarPickerModal?.classList.contains('hidden')) {
      this.closeAvatarPicker();
      return;
    }

    if (this.elements.modal?.classList.contains('hidden')) {
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

  private readonly handleCryptopunkPreviewError = () => {
    this.cryptopunkPreviewBroken = true;
    this.renderCryptopunkPicker();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly profileRepository: ProfileRepository = createProfileRepository(),
    private readonly worldRepository: WorldRepository = createWorldRepository(),
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
    private readonly avatarRepository: AvatarRepository = createAvatarRepository(),
    private readonly playlistRepository: PlaylistRepository = createPlaylistRepository(),
  ) {
    this.elements = {
      modal: this.doc.getElementById('profile-modal'),
      closeButton: this.doc.getElementById('btn-profile-close') as HTMLButtonElement | null,
      shareButton: this.doc.getElementById('btn-profile-share') as HTMLButtonElement | null,
      meta: this.doc.getElementById('profile-modal-meta'),
      error: this.doc.getElementById('profile-modal-error'),
      title: this.doc.getElementById('profile-modal-title'),
      avatarImage: this.doc.getElementById('profile-avatar-image') as HTMLImageElement | null,
      avatarFallback: this.doc.getElementById('profile-avatar-fallback'),
      avatarChangeButton: this.doc.getElementById('btn-profile-avatar-change') as HTMLButtonElement | null,
      avatarPickerModal: this.doc.getElementById('avatar-picker-modal'),
      avatarPickerCloseButton: this.doc.getElementById('btn-avatar-picker-close') as HTMLButtonElement | null,
      avatarPickerGrid: this.doc.getElementById('avatar-picker-grid'),
      avatarPickerMeta: this.doc.getElementById('avatar-picker-meta'),
      cryptopunkUnlockMeta: this.doc.getElementById('profile-cryptopunk-unlock-meta'),
      cryptopunkInput: this.doc.getElementById('profile-cryptopunk-input') as HTMLInputElement | null,
      cryptopunkPreviewImage: this.doc.getElementById('profile-cryptopunk-preview-image') as HTMLImageElement | null,
      cryptopunkPreviewFallback: this.doc.getElementById('profile-cryptopunk-preview-fallback'),
      cryptopunkStatus: this.doc.getElementById('profile-cryptopunk-status'),
      cryptopunkActionButton: this.doc.getElementById('btn-profile-cryptopunk-action') as HTMLButtonElement | null,
      displayName: this.doc.getElementById('profile-display-name'),
      usernameDisplay: this.doc.getElementById('profile-username'),
      joinedDate: this.doc.getElementById('profile-joined-date'),
      heroLanes: this.doc.getElementById('profile-hero-lanes'),
      heroProgress: this.doc.getElementById('profile-hero-progress'),
      overviewBio: this.doc.getElementById('profile-overview-bio'),
      editFields: this.doc.getElementById('profile-edit-fields'),
      displayNameInput: this.doc.getElementById('profile-display-name-input') as HTMLInputElement | null,
      usernameInput: this.doc.getElementById('profile-username-input') as HTMLInputElement | null,
      bioInput: this.doc.getElementById('profile-bio-input') as HTMLTextAreaElement | null,
      saveButton: this.doc.getElementById('btn-profile-save') as HTMLButtonElement | null,
      saveStatus: this.doc.getElementById('profile-save-status'),
      tabButtons: {
        rooms: this.doc.getElementById('btn-profile-tab-rooms') as HTMLButtonElement | null,
        playlists: this.doc.getElementById('btn-profile-tab-playlists') as HTMLButtonElement | null,
        progress: this.doc.getElementById('btn-profile-tab-progress') as HTMLButtonElement | null,
        stats: this.doc.getElementById('btn-profile-tab-stats') as HTMLButtonElement | null,
      },
      panels: {
        rooms: this.doc.getElementById('profile-rooms-panel'),
        playlists: this.doc.getElementById('profile-playlists-panel'),
        progress: this.doc.getElementById('profile-progress-panel'),
        stats: this.doc.getElementById('profile-stats-panel'),
      },
      roomsList: this.doc.getElementById('profile-rooms-list'),
      roomsEmpty: this.doc.getElementById('profile-rooms-empty'),
      playlistCreateFields: this.doc.getElementById('profile-playlist-create-fields'),
      playlistTitleInput: this.doc.getElementById('profile-playlist-title-input') as HTMLInputElement | null,
      playlistSlugInput: this.doc.getElementById('profile-playlist-slug-input') as HTMLInputElement | null,
      playlistDescriptionInput: this.doc.getElementById('profile-playlist-description-input') as HTMLTextAreaElement | null,
      playlistCreateButton: this.doc.getElementById('btn-profile-playlist-create') as HTMLButtonElement | null,
      playlistSelect: this.doc.getElementById('profile-playlist-select') as HTMLSelectElement | null,
      playlistStatus: this.doc.getElementById('profile-playlist-status'),
      playlistsList: this.doc.getElementById('profile-playlists-list'),
      playlistsEmpty: this.doc.getElementById('profile-playlists-empty'),
      progressList: this.doc.getElementById('profile-progress-list'),
      statsList: this.doc.getElementById('profile-stats-list'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.shareButton?.addEventListener('click', this.handleShareClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.elements.avatarPickerModal?.addEventListener('click', this.handleAvatarPickerBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(PROFILE_OPEN_REQUEST_EVENT, this.handleProfileOpenRequest as EventListener);
    this.windowObj.addEventListener(PROFILE_INVALIDATED_EVENT, this.handleProfileInvalidated as EventListener);
    this.windowObj.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.elements.avatarImage?.addEventListener('error', this.handleAvatarImageError);
    this.elements.avatarChangeButton?.addEventListener('click', () => {
      this.openAvatarPicker();
    });
    this.elements.avatarPickerCloseButton?.addEventListener('click', () => {
      this.closeAvatarPicker();
    });
    this.elements.cryptopunkInput?.addEventListener('input', () => {
      this.queueCryptopunkStatusRefresh();
    });
    this.elements.cryptopunkActionButton?.addEventListener('click', () => {
      void this.handleCryptopunkAction();
    });
    this.elements.cryptopunkPreviewImage?.addEventListener('error', this.handleCryptopunkPreviewError);
    this.elements.saveButton?.addEventListener('click', () => {
      void this.saveProfile();
    });
    this.elements.playlistCreateButton?.addEventListener('click', () => {
      void this.createPlaylist();
    });
    this.elements.playlistTitleInput?.addEventListener('input', () => {
      this.updatePlaylistSlugDraft();
    });
    this.elements.playlistSelect?.addEventListener('change', () => {
      this.selectedPlaylistId = this.elements.playlistSelect?.value || null;
      this.renderRooms(this.currentProfile?.publishedRooms ?? []);
    });
    this.elements.displayNameInput?.addEventListener('input', () => {
      this.renderAvatar();
    });
    this.elements.usernameInput?.addEventListener('input', () => {
      this.renderShareControls();
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
    this.openProfileFromCurrentPath();
  }

  private openProfileFromCurrentPath(): void {
    const username = parseProfileSharePath(this.windowObj.location.pathname);
    if (!username) {
      return;
    }

    void this.openByUsername(username);
  }

  private async openByUsername(username: string): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    const routeKey = `username:${username}`;
    this.currentProfileUserId = routeKey;
    this.activeTab = 'rooms';
    this.activeTabAutoSelected = false;
    this.loading = true;
    this.avatarPreviewBroken = false;
    this.selectedAvatarIdDraft = DEFAULT_PLAYER_AVATAR_ID;
    this.setError(null);
    this.setSaveStatus('');
    this.setPlaylistStatus('');
    this.currentProfile = null;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();

    const loadToken = ++this.loadToken;
    try {
      const profile = await this.profileRepository.loadProfileByUsername(username);
      if (loadToken !== this.loadToken || this.currentProfileUserId !== routeKey) {
        return;
      }

      this.currentProfileUserId = profile.userId;
      this.profileCache.set(profile.userId, profile);
      this.currentProfile = profile;
      this.selectedAvatarIdDraft = resolveSelectablePlayerAvatarId(profile.selectedAvatarId);
      this.loading = false;
      this.selectDefaultTab(profile);
      this.render();
    } catch (error) {
      if (loadToken !== this.loadToken || this.currentProfileUserId !== routeKey) {
        return;
      }

      this.loading = false;
      this.currentProfile = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load profile.');
      this.render();
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
    this.selectedAvatarIdDraft = DEFAULT_PLAYER_AVATAR_ID;
    this.setError(null);
    this.setSaveStatus('');
    this.setPlaylistStatus('');
    this.currentProfile = null;
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');

    const cached = this.profileCache.get(userId);
    if (cached) {
      this.currentProfile = cached;
      this.selectedAvatarIdDraft = resolveSelectablePlayerAvatarId(cached.selectedAvatarId);
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
      this.selectedAvatarIdDraft = resolveSelectablePlayerAvatarId(profile.selectedAvatarId);
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
    this.playlistBusy = false;
    this.selectedPlaylistId = null;
    this.playlistStatus = '';
    this.avatarPreviewBroken = false;
    this.cryptopunkPreviewBroken = false;
    this.cryptopunkPreviewUrl = null;
    this.cryptopunkPreviewPunkId = null;
    this.cryptopunkStatusLoading = false;
    this.cryptopunkActionInFlight = false;
    this.cryptopunkStatus = null;
    this.cryptopunkSelectionStatus = '';
    this.cryptopunkPreviewLoadToken += 1;
    this.selectedAvatarIdDraft = DEFAULT_PLAYER_AVATAR_ID;
    this.closeAvatarPicker();
    this.cancelCryptopunkPolling();
    this.clearCryptopunkInputTimer();
    this.setError(null);
    this.setSaveStatus('');
    this.setPlaylistStatus('');
  }

  private async saveProfile(): Promise<void> {
    if (!this.currentProfile?.canEdit || this.saving) {
      return;
    }

    if (this.isSchoolAvatarOnlyEdit()) {
      await this.saveSelectedAvatarOnly();
      return;
    }

    const displayName = this.elements.displayNameInput?.value.trim() ?? '';
    const username = this.elements.usernameInput?.value.trim() ?? '';
    const bio = this.elements.bioInput?.value ?? '';

    this.saving = true;
    this.setSaveStatus('Saving profile...');
    this.setError(null);
    this.render();

    try {
      const response = await this.profileRepository.updateMyProfile({
        displayName,
        username,
        avatarUrl: null,
        bio,
        selectedAvatarId: this.selectedAvatarIdDraft,
      });
      this.profileCache.set(response.profile.userId, response.profile);
      this.currentProfile = response.profile;
      this.selectedAvatarIdDraft = resolveSelectablePlayerAvatarId(response.profile.selectedAvatarId);
      this.avatarPreviewBroken = false;
      setStoredPlayerAvatarId(response.profile.selectedAvatarId);
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

  private async saveSelectedAvatarOnly(): Promise<void> {
    if (!this.currentProfile?.canEdit || this.saving) {
      return;
    }

    this.saving = true;
    this.setSaveStatus('Saving avatar...');
    this.setError(null);
    this.render();

    try {
      await this.avatarRepository.updateMySelectedAvatar(this.selectedAvatarIdDraft);
      const updatedProfile = {
        ...this.currentProfile,
        selectedAvatarId: this.selectedAvatarIdDraft,
      };
      this.profileCache.set(updatedProfile.userId, updatedProfile);
      this.currentProfile = updatedProfile;
      this.selectedAvatarIdDraft = resolveSelectablePlayerAvatarId(updatedProfile.selectedAvatarId);
      this.avatarPreviewBroken = false;
      setStoredPlayerAvatarId(updatedProfile.selectedAvatarId);
      await refreshAuthSession();
      this.setSaveStatus('Avatar saved.');
    } catch (error) {
      this.setSaveStatus('');
      this.setError(error instanceof Error ? error.message : 'Failed to save avatar.');
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
    const canEdit = Boolean(profile?.canEdit);
    const avatarOnlyEdit = this.isSchoolAvatarOnlyEdit(profile);
    const canEditProfileText = canEdit && !avatarOnlyEdit;
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

    if (this.elements.usernameDisplay) {
      this.elements.usernameDisplay.textContent = profile?.username ? `@${profile.username}` : '';
      this.elements.usernameDisplay.classList.toggle('hidden', !profile?.username);
    }

    if (this.elements.editFields) {
      this.elements.editFields.classList.toggle('hidden', !canEditProfileText);
    }

    if (this.elements.avatarChangeButton) {
      this.elements.avatarChangeButton.classList.toggle('hidden', !canEdit);
      this.elements.avatarChangeButton.disabled = this.saving || !canEdit;
    }

    if (this.elements.displayNameInput && canEditProfileText && profile) {
      if (this.doc.activeElement !== this.elements.displayNameInput) {
        this.elements.displayNameInput.value = profile.displayName;
      }
      this.elements.displayNameInput.disabled = this.saving;
    }

    if (this.elements.usernameInput && canEditProfileText && profile) {
      if (this.doc.activeElement !== this.elements.usernameInput) {
        this.elements.usernameInput.value = profile.username ?? deriveProfileUsernameBase(profile.displayName);
      }
      this.elements.usernameInput.disabled = this.saving;
    }

    if (this.elements.bioInput && canEditProfileText && profile) {
      if (this.doc.activeElement !== this.elements.bioInput) {
        this.elements.bioInput.value = profile.bio ?? '';
      }
      this.elements.bioInput.disabled = this.saving;
    }

    if (this.elements.saveButton) {
      this.elements.saveButton.classList.toggle('hidden', !canEdit);
      this.elements.saveButton.disabled = this.saving || !canEdit;
      this.elements.saveButton.textContent = this.saving
        ? 'Saving...'
        : avatarOnlyEdit
          ? 'Save Avatar'
          : 'Save Profile';
    }

    if (this.elements.overviewBio) {
      this.elements.overviewBio.textContent = profile?.bio?.trim() || 'No bio yet.';
      this.elements.overviewBio.classList.toggle('profile-overview-bio-empty', !profile?.bio?.trim());
    }

    this.renderAvatar();
    this.renderShareControls();
    this.renderAvatarPicker();
    this.renderRooms(profile?.publishedRooms ?? []);
    this.renderPlaylists(profile?.playlists ?? [], canEditProfileText);
    this.renderProgress(profile?.progression ?? null);
    this.renderStats(profile?.stats ?? null, profile?.publishedCourseCount ?? 0);
    this.renderTabs();
  }

  private renderShareControls(): void {
    if (!this.elements.shareButton) {
      return;
    }

    const profile = this.currentProfile;
    const username = profile?.canEdit && !this.isSchoolAvatarOnlyEdit(profile)
      ? this.elements.usernameInput?.value.trim() || profile.username
      : profile?.username;
    const canShare = Boolean(profile && username && !this.loading);
    this.elements.shareButton.classList.toggle('hidden', !profile);
    this.elements.shareButton.disabled = !canShare;
    this.elements.shareButton.textContent = canShare ? 'Copy Link' : 'No Link';
  }

  private async shareCurrentProfile(): Promise<void> {
    const profile = this.currentProfile;
    const username = profile?.canEdit && !this.isSchoolAvatarOnlyEdit(profile)
      ? this.elements.usernameInput?.value.trim() || profile.username
      : profile?.username;
    if (!profile || !username) {
      return;
    }

    const shareUrl = buildProfileShareUrl(username, this.windowObj.location.href);
    try {
      if (!this.windowObj.navigator.clipboard) {
        throw new Error('Clipboard unavailable.');
      }
      await this.windowObj.navigator.clipboard.writeText(shareUrl);
      if (this.elements.shareButton) {
        this.elements.shareButton.textContent = 'Copied';
        this.windowObj.setTimeout(() => this.renderShareControls(), 1400);
      }
      this.setSaveStatus('Profile link copied.');
    } catch {
      if (this.elements.shareButton) {
        this.elements.shareButton.textContent = 'Copy Failed';
        this.windowObj.setTimeout(() => this.renderShareControls(), 1400);
      }
      this.setSaveStatus(shareUrl);
    }
  }

  private renderAvatar(): void {
    const profile = this.currentProfile;
    const nameDraft =
      this.currentProfile?.canEdit && !this.isSchoolAvatarOnlyEdit()
        ? this.elements.displayNameInput?.value.trim() || profile?.displayName || 'Profile'
        : profile?.displayName || 'Profile';
    const avatarId = profile
      ? profile.canEdit
        ? this.selectedAvatarIdDraft
        : resolveSelectablePlayerAvatarId(profile.selectedAvatarId)
      : DEFAULT_PLAYER_AVATAR_ID;

    if (this.elements.avatarFallback) {
      this.elements.avatarFallback.textContent = initialsFromDisplayName(nameDraft);
    }

    const imageEl = this.elements.avatarImage;
    if (!imageEl || this.avatarPreviewBroken) {
      imageEl?.classList.add('hidden');
      this.elements.avatarFallback?.classList.remove('hidden');
      return;
    }

    imageEl.alt = `${nameDraft} avatar`;
    if (
      imageEl.dataset.avatarId === avatarId
      && imageEl.dataset.previewLoaded === 'true'
      && imageEl.getAttribute('src')
    ) {
      imageEl.classList.remove('hidden');
      this.elements.avatarFallback?.classList.add('hidden');
      return;
    }

    imageEl.dataset.avatarId = avatarId;
    imageEl.dataset.previewLoaded = 'false';
    imageEl.classList.add('hidden');
    this.elements.avatarFallback?.classList.remove('hidden');

    const previewToken = ++this.avatarPreviewToken;
    void createPlayerAvatarPreviewDataUrl(avatarId).then((dataUrl) => {
      if (
        previewToken !== this.avatarPreviewToken
        || imageEl.dataset.avatarId !== avatarId
        || !dataUrl
      ) {
        return;
      }

      imageEl.src = dataUrl;
      imageEl.dataset.previewLoaded = 'true';
      imageEl.classList.remove('hidden');
      this.elements.avatarFallback?.classList.add('hidden');
    });
  }

  private openAvatarPicker(): void {
    if (!this.currentProfile?.canEdit || !this.elements.avatarPickerModal) {
      return;
    }

    this.elements.avatarPickerModal.classList.remove('hidden');
    this.elements.avatarPickerModal.setAttribute('aria-hidden', 'false');
    this.initializeCryptopunkPickerFromDraft();
    this.renderAvatarPicker();
  }

  private closeAvatarPicker(): void {
    if (!this.elements.avatarPickerModal) {
      return;
    }

    this.elements.avatarPickerModal.classList.add('hidden');
    this.elements.avatarPickerModal.setAttribute('aria-hidden', 'true');
    this.cancelCryptopunkPolling();
    this.clearCryptopunkInputTimer();
  }

  private renderAvatarPicker(): void {
    if (
      !this.elements.avatarPickerModal
      || this.elements.avatarPickerModal.classList.contains('hidden')
      || !this.elements.avatarPickerGrid
    ) {
      return;
    }

    const profile = this.currentProfile;
    const choices = profile?.avatarChoices ?? [];
    if (this.elements.avatarPickerMeta) {
      const playerLevel = profile?.progression.player.level ?? 1;
      this.elements.avatarPickerMeta.textContent = `Player LVL ${playerLevel} unlocks are available now.`;
    }

    this.elements.avatarPickerGrid.replaceChildren(
      ...choices.map((choice) => this.createAvatarChoiceButton(choice))
    );
    this.renderCryptopunkPicker();
  }

  private createAvatarChoiceButton(choice: PlayerAvatarChoice): HTMLButtonElement {
    const selected = choice.avatarId === this.selectedAvatarIdDraft;
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'profile-avatar-option';
    button.disabled = this.saving || !choice.unlocked;
    button.dataset.avatarKind = choice.kind;
    button.dataset.selected = selected ? 'true' : 'false';
    button.dataset.locked = choice.unlocked ? 'false' : 'true';
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (choice.colorHex && choice.unlocked) {
      button.style.setProperty('--profile-avatar-option-color', `#${choice.colorHex}`);
    }

    const preview = this.doc.createElement('div');
    preview.className = 'profile-avatar-option-preview';

    if (choice.unlocked) {
      const image = this.doc.createElement('img');
      image.className = 'profile-avatar-option-image hidden';
      image.alt = '';
      const fallback = this.doc.createElement('div');
      fallback.className = 'profile-avatar-option-preview-fallback';
      fallback.textContent = choice.kind === 'cryptopunk' ? 'P' : 'A';
      preview.append(image, fallback);
      this.attachAvatarChoicePreview(choice.avatarId, image, fallback);
    } else {
      const locked = this.doc.createElement('div');
      locked.className = 'profile-avatar-option-locked';
      locked.textContent = '?';
      preview.append(locked);
    }

    const label = this.doc.createElement('div');
    label.className = 'profile-avatar-option-label';
    label.textContent = choice.unlocked ? choice.label : 'Locked';

    const meta = this.doc.createElement('div');
    meta.className = 'profile-avatar-option-meta';
    if (selected) {
      meta.textContent = 'Selected';
    } else if (choice.unlocked) {
      meta.textContent = 'Unlocked';
    } else if (choice.unlockLevel) {
      meta.textContent = `Player LVL ${choice.unlockLevel}`;
    } else {
      meta.textContent = 'Future unlock';
    }

    button.append(preview, label, meta);
    button.addEventListener('click', () => {
      if (!choice.unlocked) {
        return;
      }

      const previousAvatarId = this.currentProfile?.selectedAvatarId ?? DEFAULT_PLAYER_AVATAR_ID;
      this.selectedAvatarIdDraft = choice.avatarId;
      this.avatarPreviewBroken = false;
      this.closeAvatarPicker();
      this.setSaveStatus(
        choice.avatarId === previousAvatarId
          ? ''
          : this.isSchoolAvatarOnlyEdit()
            ? 'Save avatar to use this choice.'
            : 'Save profile to use this avatar.'
      );
      this.render();
    });

    return button;
  }

  private attachAvatarChoicePreview(
    avatarId: string,
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement
  ): void {
    imageEl.dataset.avatarId = avatarId;
    void createPlayerAvatarPreviewDataUrl(avatarId).then((dataUrl) => {
      if (!imageEl.isConnected || imageEl.dataset.avatarId !== avatarId || !dataUrl) {
        return;
      }

      imageEl.src = dataUrl;
      imageEl.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
    });
  }

  private renderCryptopunkPicker(): void {
    if (
      !this.elements.avatarPickerModal
      || this.elements.avatarPickerModal.classList.contains('hidden')
    ) {
      return;
    }

    const profile = this.currentProfile;
    const canEdit = Boolean(profile?.canEdit);
    const actualPlayerLevel = profile?.progression.player.level ?? 1;
    const playerLevel = getEffectiveCryptopunkViewerLevel(actualPlayerLevel);
    const cryptopunksUnlocked = playerLevel >= CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL;
    const unlockOverrideActive =
      isCryptopunkUnlockOverrideEnabled()
      && actualPlayerLevel < CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL;
    const inputRaw = this.elements.cryptopunkInput?.value.trim() ?? '';
    const candidatePunkId = parsePunkIdInput(inputRaw);
    const activeStatus =
      candidatePunkId !== null && this.cryptopunkStatus?.pack.punkId === candidatePunkId
        ? this.cryptopunkStatus
        : null;
    const localPreviewUrl =
      candidatePunkId !== null && this.cryptopunkPreviewPunkId === candidatePunkId
        ? this.cryptopunkPreviewUrl?.trim() || ''
        : '';
    const packPreviewUrl = activeStatus?.pack.headImageUrl?.trim() || '';
    const previewUrl = this.cryptopunkPreviewBroken ? localPreviewUrl : packPreviewUrl || localPreviewUrl;
    const canShowPreview = Boolean(previewUrl);

    if (this.elements.cryptopunkUnlockMeta) {
      this.elements.cryptopunkUnlockMeta.textContent = unlockOverrideActive
        ? 'Test unlock override active'
        : actualPlayerLevel >= CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL
          ? `Unlocked at Player LVL ${CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL}`
          : `Unlocks at Player LVL ${CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL}`;
    }

    if (this.elements.cryptopunkInput) {
      this.elements.cryptopunkInput.disabled =
        !canEdit || this.saving || this.cryptopunkActionInFlight || !cryptopunksUnlocked;
    }

    if (this.elements.cryptopunkPreviewImage) {
      this.elements.cryptopunkPreviewImage.classList.toggle('hidden', !canShowPreview);
      this.elements.cryptopunkPreviewImage.alt =
        candidatePunkId !== null ? `CryptoPunk #${candidatePunkId}` : '';
      if (
        canShowPreview
        && this.elements.cryptopunkPreviewImage.dataset.previewUrl !== previewUrl
      ) {
        this.elements.cryptopunkPreviewImage.src = previewUrl;
        this.elements.cryptopunkPreviewImage.dataset.previewUrl = previewUrl;
      }
    }

    if (this.elements.cryptopunkPreviewFallback) {
      this.elements.cryptopunkPreviewFallback.classList.toggle('hidden', canShowPreview);
      this.elements.cryptopunkPreviewFallback.textContent =
        candidatePunkId !== null ? `Punk #${candidatePunkId}` : 'Punk #';
    }

    if (this.elements.cryptopunkStatus) {
      this.elements.cryptopunkStatus.textContent = this.buildCryptopunkStatusText({
        activeStatus,
        candidatePunkId,
        cryptopunksUnlocked,
        inputRaw,
        playerLevel,
        unlockOverrideActive,
      });
    }

    if (this.elements.cryptopunkActionButton) {
      const { disabled, label } = this.getCryptopunkActionState({
        activeStatus,
        candidatePunkId,
        cryptopunksUnlocked,
      });
      this.elements.cryptopunkActionButton.disabled = disabled;
      this.elements.cryptopunkActionButton.textContent = label;
    }
  }

  private buildCryptopunkStatusText(input: {
    activeStatus: CryptopunkAvatarStatusResponse | null;
    candidatePunkId: number | null;
    cryptopunksUnlocked: boolean;
    inputRaw: string;
    playerLevel: number;
    unlockOverrideActive: boolean;
  }): string {
    if (!this.currentProfile?.canEdit) {
      return '';
    }

    if (this.cryptopunkSelectionStatus) {
      return this.cryptopunkSelectionStatus;
    }

    if (!input.cryptopunksUnlocked) {
      return `CryptoPunk avatars unlock at Player LVL ${CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL}. You're Player LVL ${input.playerLevel}.`;
    }

    if (this.cryptopunkStatusLoading) {
      return 'Checking CryptoPunk status...';
    }

    if (input.inputRaw && input.candidatePunkId === null) {
      return 'Enter a CryptoPunk number from 0 to 9999.';
    }

    if (input.candidatePunkId === null) {
      return input.unlockOverrideActive
        ? 'Test unlock override active. Enter a CryptoPunk number to check or generate.'
        : 'Enter a CryptoPunk number to check or generate.';
    }

    const pack = input.activeStatus?.pack ?? null;
    if (!pack) {
      return `CryptoPunk #${input.candidatePunkId} is ready to check.`;
    }

    switch (pack.status) {
      case 'missing':
        return `CryptoPunk #${pack.punkId} has not been generated yet.`;
      case 'queued':
        return `CryptoPunk #${pack.punkId} is queued for generation.`;
      case 'generating':
        return `CryptoPunk #${pack.punkId} is generating now.`;
      case 'ready':
        return `CryptoPunk #${pack.punkId} is ready to select.`;
      case 'failed':
        return pack.errorMessage?.trim()
          ? `Generation failed: ${pack.errorMessage}`
          : `CryptoPunk #${pack.punkId} failed previously. Generate again to retry.`;
      default:
        return '';
    }
  }

  private getCryptopunkActionState(input: {
    activeStatus: CryptopunkAvatarStatusResponse | null;
    candidatePunkId: number | null;
    cryptopunksUnlocked: boolean;
  }): { label: string; disabled: boolean } {
    if (!this.currentProfile?.canEdit) {
      return { label: 'Unavailable', disabled: true };
    }

    if (!input.cryptopunksUnlocked) {
      return { label: 'Locked', disabled: true };
    }

    if (this.cryptopunkActionInFlight || this.saving) {
      return { label: 'Working...', disabled: true };
    }

    if (this.cryptopunkStatusLoading) {
      return { label: 'Checking...', disabled: true };
    }

    if (input.candidatePunkId === null) {
      return { label: 'Enter Punk #', disabled: true };
    }

    const pack = input.activeStatus?.pack ?? null;
    if (!pack || pack.status === 'missing' || pack.status === 'failed') {
      return { label: pack?.status === 'failed' ? 'Retry Generate' : 'Generate', disabled: false };
    }

    if (pack.status === 'queued' || pack.status === 'generating') {
      return { label: 'Generating...', disabled: true };
    }

    if (this.selectedAvatarIdDraft === pack.avatarId) {
      return { label: 'Selected', disabled: true };
    }

    return { label: 'Select', disabled: false };
  }

  private initializeCryptopunkPickerFromDraft(): void {
    this.cancelCryptopunkPolling();
    this.clearCryptopunkInputTimer();
    this.cryptopunkStatusLoading = false;
    this.cryptopunkActionInFlight = false;
    this.cryptopunkPreviewBroken = false;
    this.cryptopunkPreviewUrl = null;
    this.cryptopunkPreviewPunkId = null;
    this.cryptopunkSelectionStatus = '';
    this.cryptopunkStatus = null;

    if (!this.currentProfile?.canEdit || !this.elements.cryptopunkInput) {
      this.renderCryptopunkPicker();
      return;
    }

    const selectedPunkId = parseCryptopunkAvatarId(this.selectedAvatarIdDraft);
    this.elements.cryptopunkInput.value = selectedPunkId !== null ? String(selectedPunkId) : '';
    if (selectedPunkId !== null) {
      void this.refreshCryptopunkPreview(selectedPunkId);
      void this.refreshCryptopunkStatus(selectedPunkId);
    } else {
      this.renderCryptopunkPicker();
    }
  }

  private queueCryptopunkStatusRefresh(): void {
    this.clearCryptopunkInputTimer();
    this.cancelCryptopunkPolling();
    this.cryptopunkPreviewBroken = false;
    this.cryptopunkSelectionStatus = '';

    const inputRaw = this.elements.cryptopunkInput?.value.trim() ?? '';
    const punkId = parsePunkIdInput(inputRaw);
    if (!inputRaw || punkId === null) {
      this.clearCryptopunkPreview();
      this.cryptopunkStatusLoading = false;
      this.cryptopunkStatus = null;
      this.renderCryptopunkPicker();
      return;
    }

    void this.refreshCryptopunkPreview(punkId);
    this.cryptopunkStatusLoading = true;
    this.renderCryptopunkPicker();
    this.cryptopunkInputTimer = this.windowObj.setTimeout(() => {
      void this.refreshCryptopunkStatus(punkId);
    }, 250);
  }

  private async refreshCryptopunkStatus(forcedPunkId?: number): Promise<void> {
    const punkId = forcedPunkId ?? parsePunkIdInput(this.elements.cryptopunkInput?.value.trim() ?? '');
    if (punkId === null) {
      this.cryptopunkStatusLoading = false;
      this.cryptopunkStatus = null;
      this.renderCryptopunkPicker();
      return;
    }

    const loadToken = ++this.cryptopunkLoadToken;
    this.cryptopunkStatusLoading = true;
    this.renderCryptopunkPicker();
    try {
      const status = await this.avatarRepository.loadCryptopunkStatus(punkId);
      if (loadToken !== this.cryptopunkLoadToken) {
        return;
      }

      this.cryptopunkStatus = status;
      this.cryptopunkSelectionStatus = '';
      if (status.pack.status === 'queued' || status.pack.status === 'generating') {
        this.scheduleCryptopunkPoll();
      } else {
        this.cancelCryptopunkPolling();
      }
    } catch (error) {
      if (loadToken !== this.cryptopunkLoadToken) {
        return;
      }

      this.cryptopunkStatus = null;
      this.cryptopunkSelectionStatus =
        error instanceof Error ? error.message : 'Failed to load CryptoPunk status.';
      this.cancelCryptopunkPolling();
    } finally {
      if (loadToken === this.cryptopunkLoadToken) {
        this.cryptopunkStatusLoading = false;
        this.renderCryptopunkPicker();
      }
    }
  }

  private scheduleCryptopunkPoll(delayMs: number = 2000): void {
    this.cancelCryptopunkPolling();
    this.cryptopunkPollTimer = this.windowObj.setTimeout(() => {
      void this.refreshCryptopunkStatus();
    }, delayMs);
  }

  private async refreshCryptopunkPreview(forcedPunkId?: number): Promise<void> {
    const punkId = forcedPunkId ?? parsePunkIdInput(this.elements.cryptopunkInput?.value.trim() ?? '');
    if (punkId === null) {
      this.clearCryptopunkPreview();
      this.renderCryptopunkPicker();
      return;
    }

    const loadToken = ++this.cryptopunkPreviewLoadToken;
    try {
      const previewUrl = await loadCryptopunkHeadPreviewUrl(punkId);
      if (loadToken !== this.cryptopunkPreviewLoadToken) {
        return;
      }

      this.cryptopunkPreviewPunkId = punkId;
      this.cryptopunkPreviewUrl = previewUrl;
      this.cryptopunkPreviewBroken = false;
    } catch {
      if (loadToken !== this.cryptopunkPreviewLoadToken) {
        return;
      }

      this.cryptopunkPreviewPunkId = punkId;
      this.cryptopunkPreviewUrl = null;
    } finally {
      if (loadToken === this.cryptopunkPreviewLoadToken) {
        this.renderCryptopunkPicker();
      }
    }
  }

  private cancelCryptopunkPolling(): void {
    if (this.cryptopunkPollTimer !== null) {
      this.windowObj.clearTimeout(this.cryptopunkPollTimer);
      this.cryptopunkPollTimer = null;
    }
  }

  private clearCryptopunkInputTimer(): void {
    if (this.cryptopunkInputTimer !== null) {
      this.windowObj.clearTimeout(this.cryptopunkInputTimer);
      this.cryptopunkInputTimer = null;
    }
  }

  private clearCryptopunkPreview(): void {
    this.cryptopunkPreviewLoadToken += 1;
    this.cryptopunkPreviewUrl = null;
    this.cryptopunkPreviewPunkId = null;
    this.cryptopunkPreviewBroken = false;
  }

  private async handleCryptopunkAction(): Promise<void> {
    if (!this.currentProfile?.canEdit || this.cryptopunkActionInFlight || this.saving) {
      return;
    }

    const candidatePunkId = parsePunkIdInput(this.elements.cryptopunkInput?.value.trim() ?? '');
    if (candidatePunkId === null) {
      this.cryptopunkSelectionStatus = 'Enter a CryptoPunk number from 0 to 9999.';
      this.renderCryptopunkPicker();
      return;
    }

    const playerLevel = getEffectiveCryptopunkViewerLevel(this.currentProfile.progression.player.level);
    if (playerLevel < CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL) {
      this.cryptopunkSelectionStatus =
        `CryptoPunk avatars unlock at Player LVL ${CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL}.`;
      this.renderCryptopunkPicker();
      return;
    }

    const status =
      this.cryptopunkStatus?.pack.punkId === candidatePunkId ? this.cryptopunkStatus : null;
    if (status?.pack.status === 'ready') {
      const previousAvatarId = this.currentProfile.selectedAvatarId ?? DEFAULT_PLAYER_AVATAR_ID;
      this.selectedAvatarIdDraft = status.pack.avatarId;
      this.avatarPreviewBroken = false;
      this.cryptopunkSelectionStatus =
        status.pack.avatarId === previousAvatarId ? '' : 'Save profile to use this avatar.';
      this.closeAvatarPicker();
      this.setSaveStatus(this.cryptopunkSelectionStatus);
      this.render();
      return;
    }

    this.cryptopunkActionInFlight = true;
    this.cryptopunkSelectionStatus = `Queuing CryptoPunk #${candidatePunkId}...`;
    this.setError(null);
    this.renderCryptopunkPicker();

    try {
      const response = await this.avatarRepository.generateCryptopunkAvatar(candidatePunkId);
      this.cryptopunkStatus = {
        pack: response.pack,
        unlock: {
          requiredPlayerLevel: CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
          viewerPlayerLevel: playerLevel,
          unlocked: true,
        },
      };
      this.cryptopunkSelectionStatus = `CryptoPunk #${candidatePunkId} queued.`;
      this.scheduleCryptopunkPoll(1200);
    } catch (error) {
      this.cryptopunkSelectionStatus =
        error instanceof Error ? error.message : 'Failed to queue CryptoPunk generation.';
    } finally {
      this.cryptopunkActionInFlight = false;
      this.renderCryptopunkPicker();
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

    copy.append(title, meta, this.createRoomRatingRow(room));
    button.append(preview, copy);
    this.attachRoomPreview(room, previewImage, previewFallback);
    if (this.currentProfile?.canEdit) {
      const row = this.doc.createElement('div');
      row.className = 'profile-room-playlist-row';
      row.append(button, this.createAddRoomToPlaylistButton(room));
      return row;
    }

    return button;
  }

  private createAddRoomToPlaylistButton(room: ProfilePublishedRoomEntry): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'bar-btn bar-btn-small profile-add-room-playlist-btn';
    const playlists = this.currentProfile?.playlists ?? [];
    const selectedPlaylist = this.getSelectedPlaylist();
    button.textContent = this.playlistBusy ? 'Adding...' : 'Add';
    button.disabled = this.playlistBusy || playlists.length === 0 || !selectedPlaylist;
    button.title = playlists.length === 0 ? 'Create a playlist first.' : 'Add this room to the selected playlist.';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.addRoomToSelectedPlaylist(room);
    });
    return button;
  }

  private createRoomRatingRow(room: ProfilePublishedRoomEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'profile-room-card-ratings';

    row.append(
      this.createRoomDifficultyBadge(room),
      this.createRoomQualitySummary(room),
    );
    return row;
  }

  private createRoomDifficultyBadge(room: ProfilePublishedRoomEntry): HTMLElement {
    const badge = this.doc.createElement('div');
    badge.className = 'profile-room-card-difficulty';
    const difficulty = room.consensusDifficulty;
    if (difficulty) {
      badge.dataset.difficulty = difficulty;
      badge.textContent = ROOM_DIFFICULTY_LABELS[difficulty];
    } else {
      badge.dataset.difficulty = 'unrated';
      badge.textContent = 'Unrated';
    }
    return badge;
  }

  private createRoomQualitySummary(room: ProfilePublishedRoomEntry): HTMLElement {
    const quality = this.doc.createElement('div');
    quality.className = 'profile-room-card-quality';

    const stars = this.doc.createElement('div');
    stars.className = 'profile-room-card-stars';
    const average = room.quality.adjustedAverage ?? room.quality.rawAverage ?? null;
    const filledCount = average === null ? 0 : Math.max(0, Math.min(5, Math.round(average)));
    for (let index = 0; index < 5; index += 1) {
      const star = this.doc.createElement('span');
      star.className = 'profile-room-card-star';
      if (index < filledCount) {
        star.classList.add('active');
      }
      star.textContent = '★';
      stars.appendChild(star);
    }

    const label = this.doc.createElement('div');
    label.className = 'profile-room-card-quality-label';
    label.textContent = average === null ? 'Not rated yet' : `${average.toFixed(1)} stars`;

    quality.append(stars, label);
    return quality;
  }

  private renderPlaylists(playlists: RoomPlaylistSummary[], canEdit: boolean): void {
    if (this.elements.playlistCreateFields) {
      this.elements.playlistCreateFields.classList.toggle('hidden', !canEdit);
    }

    this.syncSelectedPlaylist(playlists);
    this.renderPlaylistSelect(playlists, canEdit);
    this.renderPlaylistStatus();

    if (!this.elements.playlistsList) {
      return;
    }

    this.elements.playlistsEmpty?.classList.toggle('hidden', playlists.length > 0);
    this.elements.playlistsList.replaceChildren(
      ...playlists.map((playlist) => this.createPlaylistRow(playlist, canEdit)),
    );
  }

  private renderPlaylistSelect(playlists: RoomPlaylistSummary[], canEdit: boolean): void {
    const select = this.elements.playlistSelect;
    if (!select) {
      return;
    }

    select.replaceChildren();
    if (playlists.length === 0) {
      const option = this.doc.createElement('option');
      option.value = '';
      option.textContent = 'Create a playlist first';
      select.appendChild(option);
    } else {
      for (const playlist of playlists) {
        const option = this.doc.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.title;
        select.appendChild(option);
      }
    }
    select.value = this.selectedPlaylistId ?? '';
    select.disabled = !canEdit || this.playlistBusy || playlists.length === 0;
  }

  private createPlaylistRow(playlist: RoomPlaylistSummary, canEdit: boolean): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'profile-playlist-card';

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'profile-playlist-open';
    button.addEventListener('click', () => {
      if (requestPlaylistOpen(playlist.slug, this.windowObj)) {
        this.close();
      }
    });

    const title = this.doc.createElement('div');
    title.className = 'profile-room-card-title';
    title.textContent = playlist.title;

    const meta = this.doc.createElement('div');
    meta.className = 'profile-room-card-meta';
    meta.textContent = `${playlist.roomCount} ${playlist.roomCount === 1 ? 'room' : 'rooms'} · /playlist/${playlist.slug}`;

    const description = this.doc.createElement('div');
    description.className = 'profile-playlist-description';
    description.textContent = playlist.description?.trim() || 'No description yet.';
    description.classList.toggle('profile-overview-bio-empty', !playlist.description?.trim());

    button.append(title, meta, description);
    row.appendChild(button);

    const actions = this.doc.createElement('div');
    actions.className = 'profile-playlist-actions';

    const copyButton = this.doc.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'bar-btn bar-btn-small';
    copyButton.textContent = 'Copy Link';
    copyButton.addEventListener('click', () => {
      void this.copyPlaylistLink(playlist);
    });
    actions.appendChild(copyButton);

    if (canEdit) {
      const selectButton = this.doc.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'bar-btn bar-btn-small';
      selectButton.textContent = playlist.id === this.selectedPlaylistId ? 'Selected' : 'Use';
      selectButton.disabled = this.playlistBusy || playlist.id === this.selectedPlaylistId;
      selectButton.addEventListener('click', () => {
        this.selectedPlaylistId = playlist.id;
        this.setPlaylistStatus(`Adding rooms to "${playlist.title}".`);
        this.render();
      });
      actions.appendChild(selectButton);
    }

    row.appendChild(actions);
    return row;
  }

  private async createPlaylist(): Promise<void> {
    if (!this.currentProfile?.canEdit || this.playlistBusy) {
      return;
    }

    const title = this.elements.playlistTitleInput?.value.trim() ?? '';
    const slug = this.elements.playlistSlugInput?.value.trim() ?? '';
    const description = this.elements.playlistDescriptionInput?.value ?? '';

    this.playlistBusy = true;
    this.setPlaylistStatus('Creating playlist...');
    this.setError(null);
    this.render();

    try {
      const playlist = await this.playlistRepository.createPlaylist({
        title,
        slug: slug || null,
        description,
      });
      this.selectedPlaylistId = playlist.id;
      await this.reloadCurrentProfile();
      if (this.elements.playlistTitleInput) {
        this.elements.playlistTitleInput.value = '';
      }
      if (this.elements.playlistSlugInput) {
        this.elements.playlistSlugInput.value = '';
      }
      if (this.elements.playlistDescriptionInput) {
        this.elements.playlistDescriptionInput.value = '';
      }
      this.activeTab = 'playlists';
      this.setPlaylistStatus(`Created "${playlist.title}".`);
    } catch (error) {
      this.setPlaylistStatus('');
      this.setError(error instanceof Error ? error.message : 'Failed to create playlist.');
    } finally {
      this.playlistBusy = false;
      this.render();
    }
  }

  private async addRoomToSelectedPlaylist(room: ProfilePublishedRoomEntry): Promise<void> {
    const playlist = this.getSelectedPlaylist();
    if (!playlist || !this.currentProfile?.canEdit || this.playlistBusy) {
      return;
    }

    this.playlistBusy = true;
    this.setPlaylistStatus(`Adding room to "${playlist.title}"...`);
    this.setError(null);
    this.render();

    try {
      await this.playlistRepository.addPlaylistItem(playlist.id, {
        roomId: room.roomId,
        roomCoordinates: room.roomCoordinates,
        roomVersion: room.roomVersion,
      });
      await this.reloadCurrentProfile();
      this.setPlaylistStatus(`Added "${room.roomTitle?.trim() || 'room'}" to "${playlist.title}".`);
    } catch (error) {
      this.setPlaylistStatus('');
      this.setError(error instanceof Error ? error.message : 'Failed to add room to playlist.');
    } finally {
      this.playlistBusy = false;
      this.render();
    }
  }

  private async copyPlaylistLink(playlist: RoomPlaylistSummary): Promise<void> {
    const shareUrl = buildPlaylistShareUrl(playlist.slug, this.windowObj.location.href);
    try {
      if (!this.windowObj.navigator.clipboard) {
        throw new Error('Clipboard unavailable.');
      }
      await this.windowObj.navigator.clipboard.writeText(shareUrl);
      this.setPlaylistStatus('Playlist link copied.');
    } catch {
      this.setPlaylistStatus(shareUrl);
    }
  }

  private async reloadCurrentProfile(): Promise<void> {
    const userId = this.currentProfile?.userId;
    if (!userId) {
      return;
    }
    const profile = await this.profileRepository.loadProfile(userId);
    this.profileCache.set(userId, profile);
    this.currentProfile = profile;
    this.syncSelectedPlaylist(profile.playlists);
  }

  private updatePlaylistSlugDraft(): void {
    const titleInput = this.elements.playlistTitleInput;
    const slugInput = this.elements.playlistSlugInput;
    if (!titleInput || !slugInput || this.doc.activeElement === slugInput || slugInput.value.trim()) {
      return;
    }
    slugInput.value = derivePlaylistSlugBase(titleInput.value);
  }

  private syncSelectedPlaylist(playlists: RoomPlaylistSummary[]): void {
    if (playlists.length === 0) {
      this.selectedPlaylistId = null;
      return;
    }
    if (!this.selectedPlaylistId || !playlists.some((playlist) => playlist.id === this.selectedPlaylistId)) {
      this.selectedPlaylistId = playlists[0]?.id ?? null;
    }
  }

  private getSelectedPlaylist(): RoomPlaylistSummary | null {
    const playlists = this.currentProfile?.playlists ?? [];
    return playlists.find((playlist) => playlist.id === this.selectedPlaylistId) ?? null;
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
        tone: 'player',
        title: 'PVP',
        items: [
          {
            label: 'Wins',
            value: String(stats.pvpWins),
            iconSrc: '/assets/objects/crown.png',
          },
          {
            label: 'Losses',
            value: String(stats.pvpLosses),
            iconSrc: '/assets/objects/skull.png',
          },
          {
            label: 'Draws',
            value: String(stats.pvpDraws),
            iconSrc: '/assets/objects/heart.png',
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

  private setPlaylistStatus(message: string): void {
    this.playlistStatus = message;
    this.renderPlaylistStatus();
  }

  private renderPlaylistStatus(): void {
    if (!this.elements.playlistStatus) {
      return;
    }

    this.elements.playlistStatus.textContent = this.playlistStatus;
    this.elements.playlistStatus.classList.toggle('hidden', !this.playlistStatus);
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

  private isSchoolAvatarOnlyEdit(profile: UserProfileResponse | null = this.currentProfile): boolean {
    return Boolean(
      profile?.canEdit
      && this.authState.schoolManaged
      && this.authState.user?.id === profile.userId
    );
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

function parsePunkIdInput(rawValue: string): number | null {
  if (!/^\d{1,4}$/.test(rawValue)) {
    return null;
  }

  const punkId = Number(rawValue);
  return punkId >= 0 && punkId <= 9999 ? punkId : null;
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
