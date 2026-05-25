import Phaser from 'phaser';
import {
  hasFeaturedRoomsAdminKey,
  setFeaturedRoomStatus,
} from '../../admin/featuredRoomsClient';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { createWorldRepository, type WorldRepository } from '../../persistence/worldRepository';
import type { RoomPlaylistSummary } from '../../playlists/model';
import { createPlaylistRepository, type PlaylistRepository } from '../../playlists/repository';
import { getActiveOverworldScene } from './sceneBridge';
import {
  createRunRepository,
  type RunRepository,
} from '../../runs/runRepository';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  type AuthDebugState,
} from '../../auth/client';
import { createProfileTriggerElement, requestProfileOpen } from './profileEvents';
import { requestExploreQueueStart, type ExploreQueueMode } from './exploreQueueEvents';
import {
  type BuilderDiscoveryEntry,
  type BuilderDiscoveryResponse,
  type BuilderDiscoverySort,
  ROOM_DIFFICULTIES,
  ROOM_DIFFICULTY_LABELS,
  type RoomDifficulty,
  type RoomDiscoveryEntry,
  type RoomDiscoveryResponse,
  type RoomDiscoverySort,
} from '../../runs/model';

type ExploreMode = 'rooms' | 'builders';
type ExploreSortButtonValue = Exclude<RoomDiscoverySort, 'builder'> | 'builders';

type ExploreModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  error: HTMLElement | null;
  list: HTMLElement | null;
  filterGroup: HTMLElement | null;
  queueActions: HTMLElement | null;
  builderSortGroup: HTMLElement | null;
  filterButtons: HTMLButtonElement[];
  sortButtons: HTMLButtonElement[];
  builderSortButtons: HTMLButtonElement[];
};

type PreviewTargetState = {
  room: RoomDiscoveryEntry;
  imageEl: HTMLImageElement;
  fallbackEl: HTMLElement;
};

export class ExploreModalController {
  private readonly elements: ExploreModalElements;
  private readonly roomPreviewCache = new Map<string, string | null>();
  private readonly roomPreviewLoads = new Map<string, Promise<string | null>>();
  private readonly previewTargets = new WeakMap<Element, PreviewTargetState>();
  private readonly previewObserver: IntersectionObserver | null;
  private roomDiscovery: RoomDiscoveryResponse | null = null;
  private builderDiscovery: BuilderDiscoveryResponse | null = null;
  private loading = false;
  private loaded = false;
  private builderLoaded = false;
  private authState: AuthDebugState = getAuthDebugState();
  private myPlaylists: RoomPlaylistSummary[] = [];
  private myPlaylistsLoaded = false;
  private playlistPickerRoomId: string | null = null;
  private playlistPickerSelectedId: string | null = null;
  private playlistPendingRoomId: string | null = null;
  private readonly playlistFeedbackByRoomId = new Map<string, string>();
  private readonly playlistFeedbackTimers = new Map<string, number>();
  private exploreMode: ExploreMode = 'rooms';
  private discoverFilter: RoomDifficulty | null = null;
  private discoverSort: Exclude<RoomDiscoverySort, 'builder'> = 'featured';
  private builderSort: BuilderDiscoverySort = 'alphabet';
  private featurePendingRoomId: string | null = null;

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

  private readonly handleAuthStateChanged = (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as AuthDebugState | undefined) : undefined;
    this.authState = detail ?? getAuthDebugState();
    if (!this.authState.authenticated) {
      this.myPlaylists = [];
      this.myPlaylistsLoaded = false;
      this.playlistPickerRoomId = null;
      this.playlistPickerSelectedId = null;
    }
    this.render();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly runRepository: RunRepository = createRunRepository(),
    private readonly worldRepository: WorldRepository = createWorldRepository(),
    private readonly doc: Document = document,
    private readonly playlistRepository: PlaylistRepository = createPlaylistRepository(),
  ) {
    this.elements = {
      modal: this.doc.getElementById('explore-modal'),
      closeButton: this.doc.getElementById('btn-explore-close') as HTMLButtonElement | null,
      error: this.doc.getElementById('explore-modal-error'),
      list: this.doc.getElementById('explore-list'),
      filterGroup: this.doc.getElementById('explore-filters'),
      queueActions: this.doc.getElementById('explore-queue-actions'),
      builderSortGroup: this.doc.getElementById('explore-builder-sorts'),
      filterButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#explore-filters [data-explore-difficulty]'),
      ),
      sortButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#explore-sorts [data-explore-sort]'),
      ),
      builderSortButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#explore-builder-sorts [data-explore-builder-sort]'),
      ),
    };

    this.previewObserver =
      typeof window !== 'undefined' && 'IntersectionObserver' in window
        ? new window.IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) {
                continue;
              }

              const target = this.previewTargets.get(entry.target);
              if (!target) {
                this.previewObserver?.unobserve(entry.target);
                continue;
              }

              this.previewObserver?.unobserve(entry.target);
              void this.loadAndApplyRoomPreview(target.room, target.imageEl, target.fallbackEl);
            }
          }, {
            root: null,
            rootMargin: '160px 0px',
            threshold: 0.01,
          })
        : null;
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);

    for (const button of this.elements.filterButtons) {
      button.addEventListener('click', () => {
        const difficulty = this.parseDifficultyButtonValue(button.dataset.exploreDifficulty);
        this.exploreMode = 'rooms';
        this.discoverFilter = difficulty;
        void this.loadDiscoveryResults();
      });
    }

    for (const button of this.elements.sortButtons) {
      button.addEventListener('click', () => {
        const sort = this.parseExploreSortButtonValue(button.dataset.exploreSort);
        if (!sort) {
          return;
        }
        if (sort === 'builders') {
          if (this.exploreMode === 'builders') {
            return;
          }
          this.exploreMode = 'builders';
          void this.loadBuilderDiscoveryResults();
          return;
        }
        if (this.isPersonalRoomSort(sort) && !this.authState.authenticated) {
          this.setError('Sign in to sort by your room history.');
          return;
        }

        if (this.exploreMode === 'rooms' && sort === this.discoverSort) {
          return;
        }
        this.exploreMode = 'rooms';
        this.discoverSort = sort;
        void this.loadDiscoveryResults();
      });
    }

    for (const button of this.elements.builderSortButtons) {
      button.addEventListener('click', () => {
        const sort = this.parseBuilderSortButtonValue(button.dataset.exploreBuilderSort);
        if (!sort || sort === this.builderSort) {
          return;
        }
        this.builderSort = sort;
        if (this.exploreMode === 'builders') {
          void this.loadBuilderDiscoveryResults();
        } else {
          this.render();
        }
      });
    }
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged as EventListener);
    this.previewObserver?.disconnect();
    this.clearPlaylistFeedback();
    this.close();
  }

  async open(): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.roomDiscovery = null;
    this.builderDiscovery = null;
    this.loading = true;
    this.loaded = false;
    this.builderLoaded = false;
    this.myPlaylists = [];
    this.myPlaylistsLoaded = false;
    this.playlistPickerRoomId = null;
    this.playlistPickerSelectedId = null;
    this.playlistPendingRoomId = null;
    this.clearPlaylistFeedback();
    this.exploreMode = 'rooms';
    this.discoverFilter = null;
    this.discoverSort = 'featured';
    this.builderSort = 'alphabet';
    this.featurePendingRoomId = null;
    this.setError(null);
    this.render();
    await this.loadDiscoveryResults();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.setError(null);
  }

  private async loadDiscoveryResults(): Promise<void> {
    this.loading = true;
    this.loaded = false;
    this.render();
    try {
      this.roomDiscovery = await this.runRepository.loadRoomDiscovery(
        this.discoverFilter,
        this.discoverSort,
        48,
      );
      this.setError(null);
    } catch (error) {
      console.error('Failed to load room explorer', error);
      this.roomDiscovery = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load room explorer.');
    } finally {
      this.loading = false;
      this.loaded = true;
      this.render();
    }
  }

  private async loadBuilderDiscoveryResults(): Promise<void> {
    this.loading = true;
    this.builderLoaded = false;
    this.render();
    try {
      this.builderDiscovery = await this.runRepository.loadBuilderDiscovery(
        this.builderSort,
        100,
      );
      this.setError(null);
    } catch (error) {
      console.error('Failed to load builder explorer', error);
      this.builderDiscovery = null;
      this.setError(error instanceof Error ? error.message : 'Failed to load builder explorer.');
    } finally {
      this.loading = false;
      this.builderLoaded = true;
      this.render();
    }
  }

  private render(): void {
    if (!this.elements.list) {
      return;
    }

    const buildersActive = this.exploreMode === 'builders';
    this.elements.filterGroup?.classList.toggle('hidden', buildersActive);
    this.elements.builderSortGroup?.classList.toggle('hidden', !buildersActive);
    this.elements.list.classList.toggle('explore-room-list', !buildersActive);
    this.elements.list.classList.toggle('explore-builder-list', buildersActive);

    for (const button of this.elements.filterButtons) {
      const difficulty = this.parseDifficultyButtonValue(button.dataset.exploreDifficulty);
      button.classList.toggle('active', difficulty === this.discoverFilter);
      button.disabled = this.loading || buildersActive;
    }

    for (const button of this.elements.sortButtons) {
      const sort = this.parseExploreSortButtonValue(button.dataset.exploreSort);
      button.classList.toggle(
        'active',
        sort === 'builders'
          ? buildersActive
          : !buildersActive && sort === this.discoverSort,
      );
      button.disabled = this.loading || (this.isPersonalRoomSort(sort) && !this.authState.authenticated);
      if (this.isPersonalRoomSort(sort) && !this.authState.authenticated) {
        button.title = 'Sign in to sort by your room history.';
      } else {
        button.removeAttribute('title');
      }
    }

    for (const button of this.elements.builderSortButtons) {
      const sort = this.parseBuilderSortButtonValue(button.dataset.exploreBuilderSort);
      button.classList.toggle('active', buildersActive && sort === this.builderSort);
      button.disabled = this.loading || !buildersActive;
    }

    const activeLoaded = buildersActive ? this.builderLoaded : this.loaded;
    this.renderQueueActions(buildersActive, activeLoaded);
    this.elements.list.replaceChildren();

    if (this.loading || !activeLoaded) {
      this.elements.list.appendChild(
        this.createEmptyState(buildersActive ? 'Loading builders...' : 'Loading levels...')
      );
      return;
    }

    if (buildersActive) {
      this.renderBuilderResults();
      return;
    }

    const results = (this.roomDiscovery?.results ?? []).filter((entry) => entry.goalType !== null);

    if (results.length === 0) {
      this.elements.list.appendChild(
        this.createEmptyState(this.getRoomDiscoveryEmptyText()),
      );
      return;
    }

    for (const entry of results) {
      this.elements.list.appendChild(this.renderEntry(entry));
    }
  }

  private renderQueueActions(buildersActive: boolean, activeLoaded: boolean): void {
    const container = this.elements.queueActions;
    if (!container) {
      return;
    }

    container.replaceChildren();
    const mode = this.getQueueMode();
    const entries = mode ? this.getQueueEntries(mode) : [];
    const visible =
      !buildersActive
      && activeLoaded
      && !this.loading
      && mode !== null
      && this.authState.authenticated;
    container.classList.toggle('hidden', !visible);
    if (!visible || mode === null) {
      return;
    }

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'bar-btn bar-btn-small explore-queue-start-btn';
    button.dataset.exploreQueueMode = mode;
    button.textContent = `${mode === 'play' ? 'Play All' : 'Rate All'} (${entries.length})`;
    button.disabled = this.loading || entries.length === 0;
    button.addEventListener('click', () => {
      if (entries.length === 0) {
        return;
      }
      requestExploreQueueStart({
        mode,
        entries,
        sourceLabel: mode === 'play' ? 'Unbeaten rooms' : 'Unrated rooms',
      });
      this.close();
    });

    const meta = this.doc.createElement('div');
    meta.className = 'explore-queue-actions-meta';
    meta.textContent = `${entries.length} challenge${entries.length === 1 ? '' : 's'}`;

    container.append(button, meta);
  }

  private renderBuilderResults(): void {
    if (!this.elements.list) {
      return;
    }

    const results = this.builderDiscovery?.results ?? [];
    if (results.length === 0) {
      this.elements.list.appendChild(this.createEmptyState('No published-room builders found yet.'));
      return;
    }

    for (const entry of results) {
      this.elements.list.appendChild(this.renderBuilderEntry(entry));
    }
  }

  private renderBuilderEntry(entry: BuilderDiscoveryEntry): HTMLElement {
    const item = this.doc.createElement('div');
    item.className = 'explore-builder-item';

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'explore-builder-row';
    button.addEventListener('click', () => {
      if (requestProfileOpen(entry.userId)) {
        this.close();
      }
    });

    const copy = this.doc.createElement('div');
    copy.className = 'explore-builder-copy';

    const name = this.doc.createElement('div');
    name.className = 'explore-builder-name';
    name.textContent = entry.displayName;
    copy.appendChild(name);

    if (entry.username) {
      const username = this.doc.createElement('div');
      username.className = 'explore-builder-username';
      username.textContent = `@${entry.username}`;
      copy.appendChild(username);
    }

    const latestText = entry.latestPublishedAt
      ? `Updated ${this.formatShortDate(entry.latestPublishedAt)}`
      : 'No recent activity';
    const meta = this.doc.createElement('div');
    meta.className = 'explore-builder-meta';
    meta.textContent = latestText;
    copy.appendChild(meta);

    const count = this.doc.createElement('div');
    count.className = 'explore-builder-count';
    count.textContent = `${entry.roomCount} ${entry.roomCount === 1 ? 'room' : 'rooms'}`;

    button.append(copy, count);
    item.appendChild(button);
    return item;
  }

  private renderEntry(entry: RoomDiscoveryEntry): HTMLElement {
    const item = this.doc.createElement('div');
    item.className = 'explore-room-item';

    const card = this.doc.createElement('div');
    card.className = 'explore-room-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => {
      this.close();
      void getActiveOverworldScene(this.game)?.jumpToCoordinates?.(entry.roomCoordinates);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      this.close();
      void getActiveOverworldScene(this.game)?.jumpToCoordinates?.(entry.roomCoordinates);
    });

    const preview = this.doc.createElement('div');
    preview.className = 'explore-room-preview';

    const previewImage = this.doc.createElement('img');
    previewImage.className = 'explore-room-preview-image hidden';
    previewImage.alt = `${entry.roomTitle?.trim() || 'Room'} preview`;

    const previewFallback = this.doc.createElement('div');
    previewFallback.className = 'explore-room-preview-fallback';
    previewFallback.textContent = 'Preview';

    preview.append(previewImage, previewFallback);

    const copy = this.doc.createElement('div');
    copy.className = 'explore-room-copy';

    const titleRow = this.doc.createElement('div');
    titleRow.className = 'explore-room-title-row';

    const title = this.doc.createElement('div');
    title.className = 'explore-room-title';
    title.textContent = entry.roomTitle?.trim() || (entry.goalType ? 'Untitled Level' : 'Untitled Room');
    titleRow.appendChild(title);

    if (entry.featured) {
      const badge = this.doc.createElement('div');
      badge.className = 'explore-room-featured-badge';
      badge.textContent = 'Featured';
      titleRow.appendChild(badge);
    }

    copy.appendChild(titleRow);
    copy.appendChild(this.createBuilderRow(entry));
    copy.appendChild(this.createQualityRow(entry));
    copy.appendChild(this.createDifficultyBadge(entry));

    if (entry.trophy) {
      const trophy = this.doc.createElement('div');
      trophy.className = 'explore-room-trophy';
      trophy.textContent = 'Trophy room';
      copy.appendChild(trophy);
    }

    card.append(preview, copy);
    item.appendChild(card);
    this.attachRoomPreview(entry, preview, previewImage, previewFallback);

    if (hasFeaturedRoomsAdminKey()) {
      const adminButton = this.doc.createElement('button');
      adminButton.className = 'bar-btn bar-btn-small explore-room-admin-btn';
      adminButton.type = 'button';
      adminButton.textContent =
        this.featurePendingRoomId === entry.roomId
          ? 'Saving...'
          : entry.featured
            ? 'Unfeature'
            : 'Feature';
      adminButton.disabled = this.featurePendingRoomId !== null;
      adminButton.dataset.featuredActive = entry.featured ? 'true' : 'false';
      adminButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.toggleFeaturedRoom(entry);
      });
      item.appendChild(adminButton);
    }

    if (this.authState.authenticated) {
      item.appendChild(this.createPlaylistAction(entry));
    }

    return item;
  }

  private createPlaylistAction(entry: RoomDiscoveryEntry): HTMLElement {
    const action = this.doc.createElement('div');
    action.className = 'explore-room-playlist-action';

    if (this.playlistPickerRoomId === entry.roomId && this.myPlaylists.length > 1) {
      const select = this.doc.createElement('select');
      select.className = 'explore-room-playlist-select';
      for (const playlist of this.myPlaylists) {
        const option = this.doc.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.title;
        select.appendChild(option);
      }
      select.value = this.playlistPickerSelectedId ?? this.myPlaylists[0]?.id ?? '';
      select.addEventListener('change', () => {
        this.playlistPickerSelectedId = select.value;
      });

      const addButton = this.doc.createElement('button');
      addButton.type = 'button';
      addButton.className = 'bar-btn bar-btn-small';
      addButton.textContent = this.playlistPendingRoomId === entry.roomId ? 'Adding...' : 'Add';
      addButton.disabled = this.playlistPendingRoomId !== null;
      addButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const playlist = this.myPlaylists.find((candidate) => candidate.id === select.value) ?? this.myPlaylists[0] ?? null;
        if (playlist) {
          void this.addRoomToPlaylist(entry, playlist);
        }
      });

      const cancelButton = this.doc.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'bar-btn bar-btn-small';
      cancelButton.textContent = 'Cancel';
      cancelButton.disabled = this.playlistPendingRoomId !== null;
      cancelButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.playlistPickerRoomId = null;
        this.playlistPickerSelectedId = null;
        this.render();
      });

      action.append(select, addButton, cancelButton);
      this.appendPlaylistFeedback(action, entry);
      return action;
    }

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'bar-btn bar-btn-small explore-room-playlist-btn';
    button.textContent = this.playlistPendingRoomId === entry.roomId ? 'Adding...' : 'Playlist';
    button.disabled = this.playlistPendingRoomId !== null;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.handlePlaylistAction(entry);
    });
    action.appendChild(button);
    this.appendPlaylistFeedback(action, entry);
    return action;
  }

  private async handlePlaylistAction(entry: RoomDiscoveryEntry): Promise<void> {
    const playlists = await this.ensureMyPlaylists();
    if (playlists.length === 0) {
      this.setError('Create a playlist from your profile first.');
      return;
    }

    if (playlists.length === 1) {
      await this.addRoomToPlaylist(entry, playlists[0]);
      return;
    }

    this.playlistPickerRoomId = entry.roomId;
    this.playlistPickerSelectedId = playlists[0]?.id ?? null;
    this.render();
  }

  private async ensureMyPlaylists(): Promise<RoomPlaylistSummary[]> {
    if (this.myPlaylistsLoaded) {
      return this.myPlaylists;
    }

    try {
      const response = await this.playlistRepository.loadMyPlaylists();
      this.myPlaylists = response.playlists;
      this.myPlaylistsLoaded = true;
      this.setError(null);
      return this.myPlaylists;
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Failed to load your playlists.');
      return [];
    } finally {
      this.render();
    }
  }

  private async addRoomToPlaylist(
    entry: RoomDiscoveryEntry,
    playlist: RoomPlaylistSummary,
  ): Promise<void> {
    if (this.playlistPendingRoomId !== null) {
      return;
    }

    this.playlistPendingRoomId = entry.roomId;
    this.render();
    try {
      await this.playlistRepository.addPlaylistItem(playlist.id, {
        roomId: entry.roomId,
        roomCoordinates: entry.roomCoordinates,
        roomVersion: entry.roomVersion,
      });
      this.myPlaylistsLoaded = false;
      this.playlistPickerRoomId = null;
      this.playlistPickerSelectedId = null;
      this.setPlaylistFeedback(entry.roomId, `Added to "${playlist.title}".`);
      this.setError(null);
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Failed to add room to playlist.');
    } finally {
      this.playlistPendingRoomId = null;
      this.render();
    }
  }

  private appendPlaylistFeedback(container: HTMLElement, entry: RoomDiscoveryEntry): void {
    const message = this.playlistFeedbackByRoomId.get(entry.roomId);
    if (!message) {
      return;
    }

    const feedback = this.doc.createElement('div');
    feedback.className = 'explore-room-playlist-feedback';
    feedback.textContent = message;
    container.appendChild(feedback);
  }

  private setPlaylistFeedback(roomId: string, message: string): void {
    const existingTimer = this.playlistFeedbackTimers.get(roomId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    this.playlistFeedbackByRoomId.set(roomId, message);
    const timer = window.setTimeout(() => {
      this.playlistFeedbackTimers.delete(roomId);
      this.playlistFeedbackByRoomId.delete(roomId);
      this.render();
    }, 2400);
    this.playlistFeedbackTimers.set(roomId, timer);
  }

  private clearPlaylistFeedback(): void {
    for (const timer of this.playlistFeedbackTimers.values()) {
      window.clearTimeout(timer);
    }
    this.playlistFeedbackTimers.clear();
    this.playlistFeedbackByRoomId.clear();
  }

  private createBuilderRow(entry: RoomDiscoveryEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'explore-room-builder';

    const label = this.doc.createElement('span');
    label.className = 'explore-room-builder-label';
    label.textContent = 'By';
    row.appendChild(label);

    const builderLabel = entry.builderDisplayName?.trim() || 'Unknown builder';
    const trigger = createProfileTriggerElement(
      this.doc,
      entry.builderUserId,
      builderLabel,
      'explore-room-builder-name',
    );
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    trigger.addEventListener('keydown', (event) => {
      event.stopPropagation();
    });
    row.appendChild(trigger);

    return row;
  }

  private createQualityRow(entry: RoomDiscoveryEntry): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'explore-room-quality';

    const stars = this.doc.createElement('div');
    stars.className = 'explore-room-stars';
    const average = entry.quality.adjustedAverage ?? entry.quality.rawAverage ?? null;
    const filledCount = average === null ? 0 : Math.max(0, Math.min(5, Math.round(average)));

    for (let index = 0; index < 5; index += 1) {
      const star = this.doc.createElement('span');
      star.className = 'explore-room-star';
      if (index < filledCount) {
        star.classList.add('active');
      }
      star.textContent = '★';
      stars.appendChild(star);
    }

    const label = this.doc.createElement('div');
    label.className = 'explore-room-quality-label';
    label.textContent =
      average === null
        ? 'Not rated yet'
        : `${average.toFixed(1)} stars`;

    row.append(stars, label);
    return row;
  }

  private createDifficultyBadge(entry: RoomDiscoveryEntry): HTMLElement {
    const badge = this.doc.createElement('div');
    badge.className = 'explore-room-difficulty';
    if (!entry.goalType) {
      badge.dataset.difficulty = 'none';
      badge.textContent = 'No challenge';
      return badge;
    }

    const difficulty = entry.consensusDifficulty;
    if (difficulty) {
      badge.dataset.difficulty = difficulty;
      badge.textContent = ROOM_DIFFICULTY_LABELS[difficulty];
    } else {
      badge.dataset.difficulty = 'unrated';
      badge.textContent = 'Unrated';
    }
    return badge;
  }

  private attachRoomPreview(
    room: RoomDiscoveryEntry,
    previewEl: HTMLElement,
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
  ): void {
    const previewKey = this.buildRoomPreviewKey(room);
    imageEl.dataset.previewKey = previewKey;

    const cached = this.roomPreviewCache.get(previewKey);
    if (cached !== undefined) {
      this.applyRoomPreview(imageEl, fallbackEl, cached, room);
      return;
    }

    fallbackEl.textContent = 'Preview';
    imageEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');

    if (this.previewObserver) {
      this.previewTargets.set(previewEl, { room, imageEl, fallbackEl });
      this.previewObserver.observe(previewEl);
      return;
    }

    void this.loadAndApplyRoomPreview(room, imageEl, fallbackEl);
  }

  private async loadAndApplyRoomPreview(
    room: RoomDiscoveryEntry,
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
  ): Promise<void> {
    const previewKey = this.buildRoomPreviewKey(room);
    const dataUrl = await this.loadRoomPreview(room);
    if (!imageEl.isConnected || imageEl.dataset.previewKey !== previewKey) {
      return;
    }
    this.applyRoomPreview(imageEl, fallbackEl, dataUrl, room);
  }

  private applyRoomPreview(
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
    dataUrl: string | null,
    room: RoomDiscoveryEntry,
  ): void {
    if (dataUrl) {
      imageEl.src = dataUrl;
      imageEl.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
      return;
    }

    fallbackEl.textContent = room.roomTitle?.trim() || 'Level';
    imageEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');
  }

  private loadRoomPreview(room: RoomDiscoveryEntry): Promise<string | null> {
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
        console.warn('Failed to load explore room preview.', room.roomId, error);
        this.roomPreviewCache.set(previewKey, null);
        return null;
      } finally {
        this.roomPreviewLoads.delete(previewKey);
      }
    })();

    this.roomPreviewLoads.set(previewKey, request);
    return request;
  }

  private buildRoomPreviewKey(room: RoomDiscoveryEntry): string {
    return `${room.roomId}:${room.roomVersion}`;
  }

  private async toggleFeaturedRoom(entry: RoomDiscoveryEntry): Promise<void> {
    if (this.featurePendingRoomId !== null) {
      return;
    }

    this.featurePendingRoomId = entry.roomId;
    this.render();
    try {
      await setFeaturedRoomStatus(entry.roomId, {
        roomVersion: entry.roomVersion,
        featured: !entry.featured,
      });
      this.setError(null);
      await this.loadDiscoveryResults();
    } catch (error) {
      console.error('Failed to update featured room state', error);
      this.setError(
        error instanceof Error ? error.message : 'Failed to update featured room state.',
      );
    } finally {
      this.featurePendingRoomId = null;
      this.render();
    }
  }

  private createEmptyState(text: string): HTMLElement {
    const empty = this.doc.createElement('div');
    empty.className = 'leaderboard-empty';
    empty.textContent = text;
    return empty;
  }

  private parseDifficultyButtonValue(value: string | undefined): RoomDifficulty | null {
    if (!value) {
      return null;
    }

    return ROOM_DIFFICULTIES.includes(value as RoomDifficulty) ? (value as RoomDifficulty) : null;
  }

  private parseExploreSortButtonValue(value: string | undefined): ExploreSortButtonValue | null {
    if (
      value === 'featured'
      || value === 'quality'
      || value === 'newest'
      || value === 'unbeaten'
      || value === 'unvisited'
      || value === 'unrated'
      || value === 'builders'
    ) {
      return value;
    }

    return null;
  }

  private isPersonalRoomSort(sort: ExploreSortButtonValue | null): boolean {
    return sort === 'unbeaten' || sort === 'unvisited' || sort === 'unrated';
  }

  private getQueueMode(): ExploreQueueMode | null {
    if (this.discoverSort === 'unbeaten') {
      return 'play';
    }
    if (this.discoverSort === 'unrated') {
      return 'rate';
    }
    return null;
  }

  private getQueueEntries(mode: ExploreQueueMode): RoomDiscoveryEntry[] {
    const results = (this.roomDiscovery?.results ?? [])
      .filter((entry) => entry.goalType !== null);
    if (mode === 'rate') {
      const viewerUserId = this.authState.user?.id ?? null;
      return results.filter((entry) => {
        const state = entry.viewerState;
        return Boolean(
          state?.completed
          && !state.rated
          && (viewerUserId === null || entry.builderUserId !== viewerUserId),
        );
      });
    }
    return results.filter((entry) => entry.viewerState?.completed !== true);
  }

  private getRoomDiscoveryEmptyText(): string {
    if (this.discoverSort === 'unbeaten') {
      return "No unbeaten published challenge levels found.";
    }
    if (this.discoverSort === 'unvisited') {
      return "No never-visited published challenge levels found.";
    }
    if (this.discoverSort === 'unrated') {
      return "No unrated-by-you published challenge levels found.";
    }
    return this.discoverFilter === null
      ? 'No published challenge levels found yet.'
      : `No ${ROOM_DIFFICULTY_LABELS[this.discoverFilter].toLowerCase()} levels yet.`;
  }

  private parseBuilderSortButtonValue(value: string | undefined): BuilderDiscoverySort | null {
    if (value === 'alphabet' || value === 'rooms' || value === 'recent') {
      return value;
    }

    return null;
  }

  private formatShortDate(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return isoDate;
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private setError(message: string | null): void {
    if (!this.elements.error) {
      return;
    }

    if (!message) {
      this.elements.error.textContent = '';
      this.elements.error.classList.add('hidden');
      return;
    }

    this.elements.error.textContent = message;
    this.elements.error.classList.remove('hidden');
  }
}
