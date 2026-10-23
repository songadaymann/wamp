import { loadSharedRenderedRoomPreview } from '../../persistence/sharedRoomPreviewCache';
import { createWorldRepository } from '../../persistence/worldRepository';
import type Phaser from 'phaser';
import type { UserProfileResponse } from '../../profiles/model';
import { getActiveOverworldScene } from './sceneBridge';
import type { CollectionAttributionController } from './collectionAttribution';
import type { CollectedRoom } from '../../collections/model';
import { loadProfileCollection } from '../../collections/repository';
import type { RoomCoordinates } from '../../persistence/roomModel';
import { createProfileTriggerElement } from './profileEvents';

export class ProfileCollectionController {
  private userId: string | null = null;
  private cursor: string | undefined;
  private abort = new AbortController();
  private busy = false;
  private loaded = false;
  private readonly world = createWorldRepository();
  private previewObserver: IntersectionObserver | null = null;
  private readonly previewTargets = new Map<Element, { room: CollectedRoom; image: HTMLImageElement; fallback: HTMLElement }>();
  private readonly list: HTMLElement | null;
  private readonly status: HTMLElement | null;
  private readonly more: HTMLButtonElement | null;
  constructor(private readonly doc: Document, private readonly onPlay: (coordinates: RoomCoordinates) => void) {
    this.list = doc.getElementById('profile-collection-list');
    this.status = doc.getElementById('profile-collection-status');
    this.more = doc.getElementById('btn-profile-collection-more') as HTMLButtonElement | null;
    this.more?.addEventListener('click', () => void this.load());
  }
  sync(userId: string | null, active: boolean): void {
    if (this.userId !== userId || this.doc.documentElement.dataset.wallet !== 'yes') {
      this.abort.abort(); this.abort = new AbortController(); this.userId = userId;
      this.cursor = undefined; this.loaded = false; this.busy = false;
      this.previewObserver?.disconnect(); this.previewTargets.clear();
      this.list?.replaceChildren(); this.more?.classList.add('hidden');
      if (this.status) this.status.textContent = '';
    }
    if (!active) { this.abort.abort(); this.abort = new AbortController(); this.busy = false; return; }
    if (!this.loaded && !this.busy && userId && this.doc.documentElement.dataset.wallet === 'yes') void this.load();
  }
  private async load(): Promise<void> {
    if (!this.userId || this.busy || this.doc.documentElement.dataset.wallet !== 'yes') return;
    const signal = this.abort.signal, userId = this.userId;
    this.busy = true;
    if (this.more) { this.more.disabled = true; this.more.classList.add('hidden'); }
    if (this.status) this.status.textContent = 'Loading collection…';
    try {
      const page = await loadProfileCollection(userId, this.cursor, signal);
      if (signal.aborted) return;
      if (!this.loaded) this.list?.replaceChildren();
      for (const room of page.results) this.list?.append(this.renderRoom(room));
      this.loaded = true; this.cursor = page.nextCursor;
      if (this.status) this.status.textContent = this.list?.childElementCount ? '' : 'No collected rooms yet.';
      this.more?.classList.toggle('hidden', !this.cursor);
      if (this.more) this.more.textContent = 'Load more';
    } catch {
      if (signal.aborted) return;
      if (this.status) this.status.textContent = 'Could not load collection.';
      this.more?.classList.remove('hidden');
      if (this.more) this.more.textContent = 'Try again';
    } finally {
      if (!signal.aborted) { this.busy = false; if (this.more) this.more.disabled = false; }
    }
  }
  private renderRoom(room: CollectedRoom): HTMLElement {
    const row = this.doc.createElement('article'); row.className = 'profile-collection-room';
    const copy = this.doc.createElement('div'); copy.className = 'collection-room-copy';
    const title = this.doc.createElement('h3'); title.textContent = room.roomTitle || `Room ${room.roomId}`;
    const builder = this.doc.createElement('div'); builder.className = 'collection-builder'; builder.append('Built by ',
      createProfileTriggerElement(this.doc, room.builder.userId, room.builder.displayName, 'collection-person'));
    copy.append(title, builder);
    if (room.expandedRoomTitle) {
      const context = this.doc.createElement('div'); context.className = 'collection-cell-context';
      context.textContent = `${room.expandedRoomTitle} · Cell ${room.roomCoordinates.x},${room.roomCoordinates.y}`;
      copy.append(context);
    }
    const actions = this.doc.createElement('div'); actions.className = 'collection-actions';
    const play = this.doc.createElement('button'); play.type = 'button'; play.className = 'bar-btn bar-btn-small'; play.textContent = 'Play Room';
    play.addEventListener('click', () => this.onPlay(room.roomCoordinates)); actions.append(play);
    if (room.viewerUrl) {
      const viewer = this.doc.createElement('a'); viewer.className = 'collection-viewer'; viewer.href = room.viewerUrl;
      viewer.textContent = 'View collectible'; viewer.target = '_blank'; viewer.rel = 'noopener noreferrer'; actions.append(viewer);
    }
    copy.append(actions);
    const preview = this.doc.createElement('div'); preview.className = 'collection-room-preview';
    const image = this.doc.createElement('img'); image.alt = `${title.textContent} preview`; image.className = 'hidden';
    const fallback = this.doc.createElement('span'); fallback.textContent = room.roomId;
    preview.append(image, fallback); row.append(preview, copy);
    this.observePreview(preview, room, image, fallback);
    return row;
  }
  private observePreview(preview: HTMLElement, room: CollectedRoom, image: HTMLImageElement, fallback: HTMLElement): void {
    this.previewTargets.set(preview, { room, image, fallback });
    this.previewObserver ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.previewObserver?.unobserve(entry.target);
        const item = this.previewTargets.get(entry.target);
        this.previewTargets.delete(entry.target);
        if (!item || this.doc.documentElement.dataset.wallet !== 'yes') continue;
        void loadSharedRenderedRoomPreview(`${item.room.roomId}:${item.room.roomVersion}`,
          () => this.world.loadPublishedRoom(item.room.roomId, item.room.roomCoordinates)).then(url => {
          if (!url || !item.image.isConnected || this.doc.documentElement.dataset.wallet !== 'yes') return;
          item.image.src = url; item.image.classList.remove('hidden'); item.fallback.classList.add('hidden');
        }).catch(() => { /* Coordinates remain a useful fallback. */ });
      }
    });
    this.previewObserver.observe(preview);
  }

}

export type ProfileTabId = 'rooms' | 'playlists' | 'progress' | 'stats' | 'collection';

export function renderProfileTabs(
  elements: { tabButtons: Record<ProfileTabId, HTMLButtonElement | null>; panels: Record<ProfileTabId, HTMLElement | null> },
  activeTab: ProfileTabId, profile: UserProfileResponse | null, loading: boolean,
  collection: ProfileCollectionController, attribution: CollectionAttributionController,
): ProfileTabId {
  const collectionAvailable = globalThis.document?.documentElement.dataset.wallet === 'yes' && profile?.collectionAvailable === true;
  elements.tabButtons.collection?.classList.toggle('hidden', !collectionAvailable);
  if (activeTab === 'collection' && !collectionAvailable && !loading) activeTab = 'rooms';
  collection.sync(profile?.userId ?? null, activeTab === 'collection' && collectionAvailable);
  for (const [tab, button] of Object.entries(elements.tabButtons)) {
    button?.classList.toggle('active', tab === activeTab);
    button?.setAttribute('aria-selected', tab === activeTab ? 'true' : 'false');
  }
  for (const [tab, panel] of Object.entries(elements.panels)) panel?.classList.toggle('hidden', tab !== activeTab);
  attribution.refresh();
  return activeTab;
}

export function createProfileCollectionController(doc: Document, game: Phaser.Game, close: () => void): ProfileCollectionController {
  return new ProfileCollectionController(doc, coordinates => {
    close();
    const scene = getActiveOverworldScene(game);
    if (!scene) return;
    void Promise.resolve(scene.jumpToCoordinates(coordinates)).then(async (jumped) => {
      if (jumped === false) return;
      const selected = scene.getSelectedRoomContext()?.coordinates;
      if (selected?.x === coordinates.x && selected.y === coordinates.y) await scene.playSelectedRoom();
    }).catch(error => console.warn('Could not open collected room.', error));
  });
}
