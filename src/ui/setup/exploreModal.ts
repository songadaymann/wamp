import Phaser from 'phaser';
import {
  hasFeaturedRoomsAdminKey,
  setFeaturedRoomStatus,
} from '../../admin/featuredRoomsClient';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { createWorldRepository, type WorldRepository } from '../../persistence/worldRepository';
import { getActiveOverworldScene } from './sceneBridge';
import {
  createRunRepository,
  type RunRepository,
} from '../../runs/runRepository';
import { createProfileTriggerElement, requestProfileOpen } from './profileEvents';
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

  constructor(
    private readonly game: Phaser.Game,
    private readonly runRepository: RunRepository = createRunRepository(),
    private readonly worldRepository: WorldRepository = createWorldRepository(),
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('explore-modal'),
      closeButton: this.doc.getElementById('btn-explore-close') as HTMLButtonElement | null,
      error: this.doc.getElementById('explore-modal-error'),
      list: this.doc.getElementById('explore-list'),
      filterGroup: this.doc.getElementById('explore-filters'),
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
    this.previewObserver?.disconnect();
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
      button.disabled = this.loading;
    }

    for (const button of this.elements.builderSortButtons) {
      const sort = this.parseBuilderSortButtonValue(button.dataset.exploreBuilderSort);
      button.classList.toggle('active', buildersActive && sort === this.builderSort);
      button.disabled = this.loading || !buildersActive;
    }

    this.elements.list.replaceChildren();

    const activeLoaded = buildersActive ? this.builderLoaded : this.loaded;
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

    const results = this.roomDiscovery?.results ?? [];

    if (results.length === 0) {
      this.elements.list.appendChild(
        this.createEmptyState(
          this.discoverFilter === null
            ? this.getEmptyRoomDiscoveryText()
            : `No ${ROOM_DIFFICULTY_LABELS[this.discoverFilter].toLowerCase()} levels yet.`,
        ),
      );
      return;
    }

    for (const entry of results) {
      this.elements.list.appendChild(this.renderEntry(entry));
    }
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

    return item;
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

  private getEmptyRoomDiscoveryText(): string {
    return this.discoverSort === 'newest'
      ? 'No published rooms found yet.'
      : 'No published challenge levels found yet.';
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
    if (value === 'featured' || value === 'quality' || value === 'newest' || value === 'builders') {
      return value;
    }

    return null;
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
