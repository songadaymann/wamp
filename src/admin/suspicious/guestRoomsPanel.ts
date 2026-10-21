import { createAdminApiClient } from '../adminApiClient';
import type { AdminGuestRoomDraft } from '../model';

/** Recently submitted guest rooms, each with Hide or Show, since they go public without review. */
export function createGuestRoomsPanel(getAdminKey: () => string): { reset(): void; load(): Promise<void>; hide(id: string): Promise<boolean> } {
  const list = document.getElementById('guest-rooms-list');
  const status = document.getElementById('guest-rooms-status');
  const client = createAdminApiClient(getAdminKey);
  let generation = 0;

  /** Resolves true only once the server changed the room. */
  async function setHidden(id: string, hidden: boolean): Promise<boolean> {
    try {
      await client.request(`/api/admin/guest-room-drafts/${encodeURIComponent(id)}/${hidden ? 'hide' : 'show'}`, { method: 'POST' });
      await load();
      return true;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not update the guest room.';
      return false;
    }
  }

  function renderDraft(draft: AdminGuestRoomDraft): HTMLElement {
    const row = document.createElement('div');
    row.className = 'audit-item';
    const title = document.createElement('strong');
    title.textContent = `${draft.title?.trim() || 'Untitled'} by ${draft.guestDisplayName}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Room ${draft.roomX}, ${draft.roomY} · ${draft.submittedAt ? new Date(draft.submittedAt).toLocaleString() : 'not dated'} · ${draft.hidden ? 'hidden' : 'public'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = draft.hidden ? 'secondary' : 'danger';
    button.textContent = draft.hidden ? 'Show in Explore' : 'Hide from Explore';
    button.addEventListener('click', () => { void setHidden(draft.id, !draft.hidden); });
    row.append(title, meta, button);
    return row;
  }

  async function load(): Promise<void> {
    if (!getAdminKey()) { reset(); return; }
    const current = ++generation;
    try {
      const response = await client.request<{ drafts: AdminGuestRoomDraft[] }>('/api/admin/guest-room-drafts');
      if (current !== generation) return;
      list?.replaceChildren(...response.drafts.map(renderDraft));
      if (status) status.textContent = response.drafts.length === 0 ? 'No submitted guest rooms.' : `${response.drafts.length} recent guest room(s).`;
    } catch (error) {
      if (current === generation && status) status.textContent = error instanceof Error ? error.message : 'Could not load guest rooms.';
    }
  }

  function reset(): void {
    generation += 1;
    list?.replaceChildren();
    if (status) status.textContent = 'Use an admin key to load guest rooms.';
  }

  return { reset, load, hide: (id) => setHidden(id, true) };
}
