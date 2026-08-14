import { createAdminApiClient } from './admin/adminApiClient';
import type {
  CustomSpriteCatalogEntry,
  CustomSpriteCatalogPage,
  CustomSpriteCatalogStatus,
} from './customSprites/catalog';
import { getCustomSpriteKindLabel, type CustomSpriteDefinition } from './customSprites/model';

export interface CustomSpriteAdminController {
  refresh(): Promise<void>;
  handleAdminKeyChange(): void;
}

export function setupCustomSpriteAdminController(options: {
  getAdminKey(): string;
}): CustomSpriteAdminController {
  const statusFilter = byId<HTMLSelectElement>('custom-sprite-admin-status-filter');
  const queryInput = byId<HTMLInputElement>('custom-sprite-admin-query');
  const refreshButton = byId<HTMLButtonElement>('custom-sprite-admin-refresh');
  const statusElement = byId<HTMLElement>('custom-sprite-admin-status');
  const list = byId<HTMLElement>('custom-sprite-admin-list');
  const loadMoreButton = byId<HTMLButtonElement>('custom-sprite-admin-load-more');
  const client = createAdminApiClient(options.getAdminKey);
  let entries: CustomSpriteCatalogEntry[] = [];
  let nextCursor: string | null = null;
  let loading = false;

  refreshButton?.addEventListener('click', () => void refresh());
  statusFilter?.addEventListener('change', () => void refresh());
  queryInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void refresh();
  });
  loadMoreButton?.addEventListener('click', () => void load(false));
  renderLocked();

  return {
    refresh,
    handleAdminKeyChange() {
      if (options.getAdminKey()) void refresh();
      else renderLocked();
    },
  };

  async function refresh(): Promise<void> {
    entries = [];
    nextCursor = null;
    await load(true);
  }

  async function load(reset: boolean): Promise<void> {
    if (loading) return;
    if (!options.getAdminKey()) {
      renderLocked();
      return;
    }
    loading = true;
    setStatus('Loading community sprites…', false);
    if (loadMoreButton) loadMoreButton.disabled = true;
    try {
      const params = new URLSearchParams({
        status: statusFilter?.value === 'blocked' ? 'blocked' : 'active',
        limit: '48',
      });
      const query = queryInput?.value.trim();
      if (query) params.set('query', query);
      if (!reset && nextCursor) params.set('cursor', nextCursor);
      const page = await client.request<CustomSpriteCatalogPage>(
        `/api/admin/custom-sprites?${params.toString()}`,
      );
      entries = reset ? page.sprites : [...entries, ...page.sprites];
      nextCursor = page.nextCursor;
      renderEntries();
      setStatus(`${entries.length} ${entries.length === 1 ? 'sprite' : 'sprites'} shown.`, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load sprites.', true);
    } finally {
      loading = false;
      if (loadMoreButton) {
        loadMoreButton.disabled = false;
        loadMoreButton.hidden = !nextCursor;
      }
    }
  }

  function renderEntries(): void {
    if (!list) return;
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'admin-empty-state';
      empty.textContent = 'No sprites in this view.';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) list.appendChild(buildCard(entry));
  }

  function buildCard(entry: CustomSpriteCatalogEntry): HTMLElement {
    const card = document.createElement('article');
    card.className = 'panel sprite-review-card';
    card.dataset.status = entry.status;
    const preview = document.createElement('img');
    preview.className = 'sprite-review-preview';
    preview.src = createSpriteDataUrl(entry.sprite);
    preview.alt = '';
    const copy = document.createElement('div');
    copy.className = 'sprite-review-copy';
    const title = document.createElement('h3');
    title.textContent = entry.sprite.name;
    const creator = document.createElement('div');
    creator.className = 'meta';
    creator.textContent = `by ${entry.creator.displayName}${entry.creator.username ? ` (@${entry.creator.username})` : ''}`;
    const details = document.createElement('div');
    details.className = 'meta';
    details.textContent = `${entry.sprite.size}×${entry.sprite.size} · ${getCustomSpriteKindLabel(entry.sprite.kind)} · rev ${entry.revision}`;
    const id = document.createElement('div');
    id.className = 'meta';
    id.textContent = entry.sprite.id;
    copy.append(title, creator, details, id);
    if (entry.remixedFrom) {
      const remix = document.createElement('div');
      remix.className = 'meta';
      remix.textContent = `Remix of ${entry.remixedFrom.name} by ${entry.remixedFrom.creatorDisplayName}`;
      copy.appendChild(remix);
    }
    const actions = document.createElement('div');
    actions.className = 'controls sprite-review-actions';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = entry.status === 'blocked' ? 'success' : 'danger';
    action.textContent = entry.status === 'blocked' ? 'Restore to Community' : 'Hide from Community';
    action.addEventListener('click', () => void moderate(entry, action));
    actions.appendChild(action);
    card.append(preview, copy, actions);
    return card;
  }

  async function moderate(entry: CustomSpriteCatalogEntry, button: HTMLButtonElement): Promise<void> {
    const nextStatus: Extract<CustomSpriteCatalogStatus, 'active' | 'blocked'> =
      entry.status === 'blocked' ? 'active' : 'blocked';
    button.disabled = true;
    setStatus(nextStatus === 'blocked' ? 'Hiding sprite…' : 'Restoring sprite…', false);
    try {
      await client.request(`/api/admin/custom-sprites/${encodeURIComponent(entry.sprite.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      entries = entries.filter((candidate) => candidate.sprite.id !== entry.sprite.id);
      renderEntries();
      setStatus(nextStatus === 'blocked'
        ? 'Sprite hidden from discovery. Existing rooms are unchanged.'
        : 'Sprite restored to Community.', false);
    } catch (error) {
      button.disabled = false;
      setStatus(error instanceof Error ? error.message : 'Moderation failed.', true);
    }
  }

  function renderLocked(): void {
    entries = [];
    nextCursor = null;
    if (loadMoreButton) loadMoreButton.hidden = true;
    setStatus('Paste the admin key to load community sprites.', false);
    if (list) {
      list.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'admin-empty-state';
      empty.textContent = 'Community sprite review is locked.';
      list.appendChild(empty);
    }
  }

  function setStatus(message: string, error: boolean): void {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.classList.toggle('error', error);
  }
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function createSpriteDataUrl(sprite: CustomSpriteDefinition): string {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.size;
  canvas.height = sprite.size;
  const context = canvas.getContext('2d');
  if (!context) return '';
  for (let index = 0; index < sprite.pixels.length; index += 1) {
    const color = sprite.pixels[index];
    if (!color) continue;
    context.fillStyle = color;
    context.fillRect(index % sprite.size, Math.floor(index / sprite.size), 1, 1);
  }
  return canvas.toDataURL('image/png');
}
