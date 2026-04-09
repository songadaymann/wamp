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
import { createProfileTriggerElement } from './profileEvents';
import {
  ROOM_DIFFICULTIES,
  ROOM_DIFFICULTY_LABELS,
  type RoomDifficulty,
  type RoomDiscoveryEntry,
  type RoomDiscoveryResponse,
  type RoomDiscoverySort,
} from '../../runs/model';

type ExploreModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  error: HTMLElement | null;
  list: HTMLElement | null;
  filterButtons: HTMLButtonElement[];
  sortButtons: HTMLButtonElement[];
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
  private loading = false;
  private loaded = false;
  private discoverFilter: RoomDifficulty | null = null;
  private discoverSort: RoomDiscoverySort = 'featured';
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
      filterButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#explore-filters [data-explore-difficulty]'),
      ),
      sortButtons: Array.from(
        this.doc.querySelectorAll<HTMLButtonElement>('#explore-sorts [data-explore-sort]'),
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
        this.discoverFilter = difficulty;
        void this.loadDiscoveryResults();
      });
    }

    for (const button of this.elements.sortButtons) {
      button.addEventListener('click', () => {
        const sort = this.parseDiscoverSortButtonValue(button.dataset.exploreSort);
        if (!sort || sort === this.discoverSort) {
          return;
        }
        this.discoverSort = sort;
        void this.loadDiscoveryResults();
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
    this.loading = true;
    this.loaded = false;
    this.discoverFilter = null;
    this.discoverSort = 'featured';
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

  private render(): void {
    if (!this.elements.list) {
      return;
    }

    for (const button of this.elements.filterButtons) {
      const difficulty = this.parseDifficultyButtonValue(button.dataset.exploreDifficulty);
      button.classList.toggle('active', difficulty === this.discoverFilter);
      button.disabled = this.loading;
    }

    for (const button of this.elements.sortButtons) {
      const sort = this.parseDiscoverSortButtonValue(button.dataset.exploreSort);
      button.classList.toggle('active', sort === this.discoverSort);
      button.disabled = this.loading;
    }

    this.elements.list.replaceChildren();

    if (this.loading || !this.loaded) {
      this.elements.list.appendChild(this.createEmptyState('Loading levels...'));
      return;
    }

    const results = this.roomDiscovery?.results ?? [];

    if (results.length === 0) {
      this.elements.list.appendChild(
        this.createEmptyState(
          this.discoverFilter === null
            ? 'No published challenge levels found yet.'
            : `No ${ROOM_DIFFICULTY_LABELS[this.discoverFilter].toLowerCase()} levels yet.`,
        ),
      );
      return;
    }

    for (const entry of results) {
      this.elements.list.appendChild(this.renderEntry(entry));
    }
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
    title.textContent = entry.roomTitle?.trim() || 'Untitled Level';
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

  private parseDiscoverSortButtonValue(value: string | undefined): RoomDiscoverySort | null {
    if (value === 'featured' || value === 'quality' || value === 'newest' || value === 'builder') {
      return value;
    }

    return null;
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
