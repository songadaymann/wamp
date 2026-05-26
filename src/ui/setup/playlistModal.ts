import Phaser from 'phaser';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { createWorldRepository, type WorldRepository } from '../../persistence/worldRepository';
import type { RoomPlaylistItem, RoomPlaylistResponse } from '../../playlists/model';
import {
  buildPlaylistShareUrl,
  parsePlaylistSharePath,
} from '../../playlists/model';
import { createPlaylistRepository, type PlaylistRepository } from '../../playlists/repository';
import { getActiveOverworldScene } from './sceneBridge';
import {
  PLAYLIST_OPEN_REQUEST_EVENT,
  type PlaylistOpenRequestDetail,
} from './playlistEvents';
import { requestRoomSequenceStart } from './roomSequenceEvents';

type PlaylistModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  shareButton: HTMLButtonElement | null;
  playButton: HTMLButtonElement | null;
  error: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  description: HTMLElement | null;
  list: HTMLElement | null;
  empty: HTMLElement | null;
};

export class PlaylistModalController {
  private readonly elements: PlaylistModalElements;
  private readonly roomPreviewCache = new Map<string, string | null>();
  private readonly roomPreviewLoads = new Map<string, Promise<string | null>>();
  private currentPlaylist: RoomPlaylistResponse | null = null;
  private currentSlug: string | null = null;
  private loading = false;
  private removingItemId: string | null = null;

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleShareClick = () => {
    void this.shareCurrentPlaylist();
  };

  private readonly handlePlayClick = () => {
    this.startCurrentPlaylistPlayback({ fromShareLink: false });
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

  private readonly handlePlaylistOpenRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as PlaylistOpenRequestDetail | undefined)
        : undefined;
    if (!detail?.slug) {
      return;
    }
    void this.open(detail.slug);
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly playlistRepository: PlaylistRepository = createPlaylistRepository(),
    private readonly worldRepository: WorldRepository = createWorldRepository(),
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('playlist-modal'),
      closeButton: this.doc.getElementById('btn-playlist-close') as HTMLButtonElement | null,
      shareButton: this.doc.getElementById('btn-playlist-share') as HTMLButtonElement | null,
      playButton: this.doc.getElementById('btn-playlist-play') as HTMLButtonElement | null,
      error: this.doc.getElementById('playlist-modal-error'),
      title: this.doc.getElementById('playlist-modal-title'),
      meta: this.doc.getElementById('playlist-modal-meta'),
      description: this.doc.getElementById('playlist-description'),
      list: this.doc.getElementById('playlist-room-list'),
      empty: this.doc.getElementById('playlist-rooms-empty'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.shareButton?.addEventListener('click', this.handleShareClick);
    this.elements.playButton?.addEventListener('click', this.handlePlayClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(PLAYLIST_OPEN_REQUEST_EVENT, this.handlePlaylistOpenRequest as EventListener);
    this.openPlaylistFromCurrentPath();
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }
    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.currentPlaylist = null;
    this.currentSlug = null;
    this.loading = false;
    this.removingItemId = null;
    this.setError(null);
  }

  async open(slug: string, options: { autoPlay?: boolean } = {}): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    this.currentSlug = slug;
    this.currentPlaylist = null;
    this.loading = true;
    this.setError(null);
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();

    try {
      const playlist = await this.playlistRepository.loadPlaylistBySlug(slug);
      if (this.currentSlug !== slug) {
        return;
      }
      this.currentPlaylist = playlist;
      this.loading = false;
      this.render();
      if (options.autoPlay) {
        this.startCurrentPlaylistPlayback({ fromShareLink: true });
      }
    } catch (error) {
      if (this.currentSlug !== slug) {
        return;
      }
      this.currentPlaylist = null;
      this.loading = false;
      this.setError(error instanceof Error ? error.message : 'Failed to load playlist.');
      this.render();
    }
  }

  private openPlaylistFromCurrentPath(): void {
    const slug = parsePlaylistSharePath(this.windowObj.location.pathname);
    if (!slug) {
      return;
    }
    void this.open(slug, { autoPlay: true });
  }

  private render(): void {
    const playlist = this.currentPlaylist;
    if (this.elements.title) {
      this.elements.title.textContent = this.loading
        ? 'Loading playlist...'
        : playlist?.title ?? 'Playlist';
    }
    if (this.elements.meta) {
      this.elements.meta.textContent = playlist
        ? `${playlist.items.length} ${playlist.items.length === 1 ? 'room' : 'rooms'} by ${playlist.ownerDisplayName}`
        : this.loading
          ? 'Loading rooms...'
          : '';
    }
    if (this.elements.description) {
      this.elements.description.textContent = playlist?.description?.trim() || '';
      this.elements.description.classList.toggle('hidden', !playlist?.description?.trim());
    }
    if (this.elements.shareButton) {
      this.elements.shareButton.classList.toggle('hidden', !playlist);
      this.elements.shareButton.disabled = !playlist;
      this.elements.shareButton.textContent = 'Copy Link';
    }
    if (this.elements.playButton) {
      const canPlay = Boolean(playlist && playlist.items.length > 0);
      this.elements.playButton.classList.toggle('hidden', !playlist);
      this.elements.playButton.disabled = !canPlay;
    }

    this.renderRooms(playlist?.items ?? []);
  }

  private renderRooms(items: RoomPlaylistItem[]): void {
    if (!this.elements.list) {
      return;
    }

    this.elements.empty?.classList.toggle('hidden', this.loading || items.length > 0);
    this.elements.list.replaceChildren();

    if (this.loading) {
      this.elements.list.appendChild(this.createEmptyState('Loading playlist rooms...'));
      return;
    }

    for (const item of items) {
      this.elements.list.appendChild(this.createRoomRow(item));
    }
  }

  private createRoomRow(item: RoomPlaylistItem): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'playlist-room-row';

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'profile-room-card playlist-room-card';
    button.addEventListener('click', () => {
      this.close();
      void getActiveOverworldScene(this.game)?.jumpToCoordinates?.(item.roomCoordinates);
    });

    const preview = this.doc.createElement('div');
    preview.className = 'profile-room-preview';

    const previewImage = this.doc.createElement('img');
    previewImage.className = 'profile-room-preview-image hidden';
    previewImage.alt = `${this.getPlaylistItemTitle(item)} preview`;

    const previewFallback = this.doc.createElement('div');
    previewFallback.className = 'profile-room-preview-fallback';
    previewFallback.textContent = `${item.roomCoordinates.x},${item.roomCoordinates.y}`;
    preview.append(previewImage, previewFallback);

    const copy = this.doc.createElement('div');
    copy.className = 'profile-room-card-copy';

    const title = this.doc.createElement('div');
    title.className = 'profile-room-card-title';
    title.textContent = this.getPlaylistItemTitle(item);

    const meta = this.doc.createElement('div');
    meta.className = 'profile-room-card-meta';
    meta.textContent = this.getPlaylistItemMeta(item);

    copy.append(title, meta);
    button.append(preview, copy);
    row.appendChild(button);
    this.attachRoomPreview(item, previewImage, previewFallback);

    if (this.currentPlaylist?.viewerCanEdit) {
      const removeButton = this.doc.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'bar-btn bar-btn-small playlist-remove-room-btn';
      removeButton.textContent = this.removingItemId === item.id ? 'Removing...' : 'Remove';
      removeButton.disabled = this.removingItemId !== null;
      removeButton.addEventListener('click', () => {
        void this.removePlaylistItem(item.id);
      });
      row.appendChild(removeButton);
    }

    return row;
  }

  private attachRoomPreview(
    item: RoomPlaylistItem,
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
  ): void {
    const previewKey = `${item.roomId}:${item.roomVersion}`;
    imageEl.dataset.previewKey = previewKey;
    const cached = this.roomPreviewCache.get(previewKey);
    if (cached !== undefined) {
      this.applyRoomPreview(imageEl, fallbackEl, cached, item);
      return;
    }

    void this.loadRoomPreview(item).then((dataUrl) => {
      if (!imageEl.isConnected || imageEl.dataset.previewKey !== previewKey) {
        return;
      }
      this.applyRoomPreview(imageEl, fallbackEl, dataUrl, item);
    });
  }

  private applyRoomPreview(
    imageEl: HTMLImageElement,
    fallbackEl: HTMLElement,
    dataUrl: string | null,
    item: RoomPlaylistItem,
  ): void {
    if (dataUrl) {
      imageEl.src = dataUrl;
      imageEl.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
      return;
    }
    fallbackEl.textContent = this.getPlaylistItemTitle(item);
    imageEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');
  }

  private loadRoomPreview(item: RoomPlaylistItem): Promise<string | null> {
    const previewKey = `${item.roomId}:${item.roomVersion}`;
    const inFlight = this.roomPreviewLoads.get(previewKey);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        const snapshot = await this.worldRepository.loadPublishedRoom(item.roomId, item.roomCoordinates);
        if (!snapshot) {
          this.roomPreviewCache.set(previewKey, null);
          return null;
        }
        const dataUrl = await renderRoomSnapshotToPngDataUrl(snapshot, { tilePixelSize: 4 });
        this.roomPreviewCache.set(previewKey, dataUrl);
        return dataUrl;
      } catch (error) {
        console.warn('Failed to load playlist room preview.', item.roomId, error);
        this.roomPreviewCache.set(previewKey, null);
        return null;
      } finally {
        this.roomPreviewLoads.delete(previewKey);
      }
    })();

    this.roomPreviewLoads.set(previewKey, request);
    return request;
  }

  private async removePlaylistItem(itemId: string): Promise<void> {
    const playlist = this.currentPlaylist;
    if (!playlist?.viewerCanEdit || this.removingItemId !== null) {
      return;
    }

    this.removingItemId = itemId;
    this.render();
    try {
      this.currentPlaylist = await this.playlistRepository.removePlaylistItem(playlist.id, itemId);
      this.setError(null);
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Failed to remove room.');
    } finally {
      this.removingItemId = null;
      this.render();
    }
  }

  private async shareCurrentPlaylist(): Promise<void> {
    const playlist = this.currentPlaylist;
    if (!playlist) {
      return;
    }

    const shareUrl = buildPlaylistShareUrl(playlist.slug, this.windowObj.location.href);
    try {
      if (!this.windowObj.navigator.clipboard) {
        throw new Error('Clipboard unavailable.');
      }
      await this.windowObj.navigator.clipboard.writeText(shareUrl);
      if (this.elements.shareButton) {
        this.elements.shareButton.textContent = 'Copied';
        this.windowObj.setTimeout(() => this.render(), 1400);
      }
    } catch {
      this.setError(shareUrl);
    }
  }

  private startCurrentPlaylistPlayback(options: { fromShareLink: boolean }): void {
    const playlist = this.currentPlaylist;
    if (!playlist) {
      return;
    }

    if (playlist.items.length === 0) {
      this.setError('No rooms in this playlist yet.');
      return;
    }

    this.close();
    requestRoomSequenceStart({
      mode: 'play',
      kind: 'playlist',
      entries: playlist.items.map((item) => ({
        roomId: item.roomId,
        roomCoordinates: item.roomCoordinates,
        roomVersion: item.roomVersion,
        roomTitle: this.getPlaylistItemTitle(item),
        expandedRoomId: item.expandedRoom?.expandedRoomId ?? null,
        expandedRoomVersion: item.expandedRoom?.expandedRoomVersion ?? null,
        expandedRoomCellCount: item.expandedRoom?.cellCount ?? null,
        legacyCourseId: item.expandedRoom?.legacyCourseId ?? null,
      })),
      sourceLabel: `${playlist.ownerDisplayName}'s playlist`,
      kickerLabel: playlist.title,
      forceGoalIntro: options.fromShareLink,
      showDesktopControlsIntro: options.fromShareLink,
    });
  }

  private createEmptyState(text: string): HTMLElement {
    const empty = this.doc.createElement('div');
    empty.className = 'leaderboard-empty';
    empty.textContent = text;
    return empty;
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

  private getPlaylistItemTitle(item: RoomPlaylistItem): string {
    return (
      item.expandedRoom?.title?.trim()
      || item.roomTitle?.trim()
      || `Room ${item.roomCoordinates.x},${item.roomCoordinates.y}`
    );
  }

  private getPlaylistItemMeta(item: RoomPlaylistItem): string {
    const goalText = item.goalType ? item.goalType.replace(/_/g, ' ') : 'free play';
    const publishedText = item.publishedAt ? this.formatShortDate(item.publishedAt) : 'Published';
    const expandedRoom = item.expandedRoom;
    if (expandedRoom && expandedRoom.cellCount > 1) {
      const versionText =
        typeof expandedRoom.expandedRoomVersion === 'number'
          ? `v${expandedRoom.expandedRoomVersion}`
          : `v${item.roomVersion}`;
      return `${goalText} · ${expandedRoom.cellCount} cells · ${versionText} · focus ${item.roomCoordinates.x},${item.roomCoordinates.y} · ${publishedText}`;
    }

    return `${goalText} · v${item.roomVersion} · ${item.roomCoordinates.x},${item.roomCoordinates.y} · ${publishedText}`;
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
