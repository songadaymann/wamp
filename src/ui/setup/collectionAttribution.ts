import type { CollectionAttribution } from '../../collections/model';
import { loadCollectorRows } from '../../collections/repository';
import { requestProfileOpen } from './profileEvents';

export function collectionAttributionSlot(doc: Document, room: { roomId: string; expandedRoom?: { expandedRoomId: string } | null }): HTMLElement {
  const slot = doc.createElement('div');
  slot.className = 'collection-attribution';
  slot.setAttribute('data-crypto', '');
  slot.dataset.collectionTarget = room.expandedRoom?.expandedRoomId ?? `room:${room.roomId}`;
  return slot;
}

/** Only visible published targets are read, once per render. No idle polling or chain reads. */
export class CollectionAttributionController {
  private observer: IntersectionObserver | null = null;
  private abort = new AbortController();
  private readonly cache = new Map<string, { at: number; row: CollectionAttribution }>();
  private pending = new Set<HTMLElement>();
  private queued = false;
  private readonly gateChanged = () => this.refresh();
  constructor(private readonly doc: Document, private readonly root: HTMLElement | null) {
    doc.defaultView?.addEventListener('wallet-gate', this.gateChanged);
  }
  destroy(): void {
    this.abort.abort(); this.observer?.disconnect();
    this.doc.defaultView?.removeEventListener('wallet-gate', this.gateChanged);
  }
  refresh(): void {
    this.abort.abort(); this.abort = new AbortController(); this.observer?.disconnect(); this.pending.clear();
    const slots = this.root?.querySelectorAll<HTMLElement>('[data-collection-target]') ?? [];
    for (const slot of slots) slot.replaceChildren();
    if (this.doc.documentElement.dataset.wallet !== 'yes') return;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting && entry.target instanceof HTMLElement) {
        this.observer?.unobserve(entry.target); this.pending.add(entry.target);
      }
      if (!this.queued && this.pending.size) {
        this.queued = true;
        queueMicrotask(() => { this.queued = false; void this.flush(); });
      }
    });
    for (const slot of slots) this.observer.observe(slot.parentElement ?? slot);
    // Observe the nonempty parent so empty attribution slots can become visible.
  }
  private async flush(): Promise<void> {
    const parents = [...this.pending]; this.pending.clear();
    const slots = parents.flatMap(parent => [...parent.querySelectorAll<HTMLElement>('[data-collection-target]')]);
    const ids = [...new Set(slots.map(slot => slot.dataset.collectionTarget!))].filter(id => {
      const cached = this.cache.get(id);
      if (!cached || Date.now() - cached.at >= 20_000) return true;
      for (const slot of slots) if (slot.isConnected && slot.dataset.collectionTarget === id) this.render(slot, cached.row);
      return false;
    });
    const signal = this.abort.signal;
    for (let offset = 0; offset < ids.length && !signal.aborted; offset += 16) {
      try {
        const response = await loadCollectorRows(ids.slice(offset, offset + 16), signal);
        if (signal.aborted || this.doc.documentElement.dataset.wallet !== 'yes') return;
        for (const row of response.results) {
          this.cache.set(row.targetId, { at: Date.now(), row });
          if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
          for (const slot of slots) {
          if (slot.isConnected && slot.dataset.collectionTarget === row.targetId) this.render(slot, row);
          }
        }
      } catch { /* Optional public credit never blocks playing or builder credit. */ }
    }
  }
  private render(slot: HTMLElement, row: CollectionAttribution): void {
    slot.replaceChildren();
    slot.title = row.ownerSyncedAt ? `Last recorded ownership: ${row.ownerSyncedAt}. Editing checks ownership separately.` : 'Last recorded ownership. Editing checks ownership separately.';
    for (const collector of row.collectors) {
      const line = this.doc.createElement('div');
      line.append('Collected by ');
      const name = this.doc.createElement(collector.userId ? 'button' : 'span');
      name.textContent = collector.displayName;
      if (name instanceof HTMLButtonElement) {
        name.type = 'button'; name.className = 'profile-trigger collection-person';
        name.addEventListener('click', event => { event.stopPropagation(); requestProfileOpen(collector.userId, 'collection'); });
        name.addEventListener('keydown', event => event.stopPropagation());
      }
      line.append(name);
      if (row.cellCount > 1) {
        const count = this.doc.createElement('span'); count.className = 'collection-cell-count';
        count.textContent = `${collector.cellCount}/${row.cellCount} cells`; line.append(' · ', count);
      }
      slot.append(line);
    }
  }
}
