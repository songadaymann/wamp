import { getApiBaseUrl } from '../api/baseUrl';
import type {
  CustomSpriteCatalogDeleteResponse,
  CustomSpriteCatalogEntry,
  CustomSpriteCatalogListOptions,
  CustomSpriteCatalogPage,
  CustomSpriteCatalogSaveRequest,
  CustomSpriteCatalogSaveResponse,
} from './catalog';
import type { CustomSpriteKind } from './model';

export class CustomSpriteCatalogApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CustomSpriteCatalogApiError';
  }
}

export function listCommunityCustomSprites(
  options: CustomSpriteCatalogListOptions = {},
): Promise<CustomSpriteCatalogPage> {
  return catalogRequest<CustomSpriteCatalogPage>(`/api/custom-sprites${buildListQuery(options)}`);
}

export function listMyCustomSprites(
  options: CustomSpriteCatalogListOptions = {},
): Promise<CustomSpriteCatalogPage> {
  return catalogRequest<CustomSpriteCatalogPage>(`/api/custom-sprites/mine${buildListQuery(options)}`);
}

export function loadCommunityCustomSprite(spriteId: string): Promise<CustomSpriteCatalogEntry> {
  return catalogRequest<{ sprite: CustomSpriteCatalogEntry }>(
    `/api/custom-sprites/${encodeURIComponent(spriteId)}`,
  ).then((response) => response.sprite);
}

export function saveCommunityCustomSprite(
  spriteId: string,
  body: CustomSpriteCatalogSaveRequest,
): Promise<CustomSpriteCatalogEntry> {
  return catalogRequest<CustomSpriteCatalogSaveResponse>(
    `/api/custom-sprites/${encodeURIComponent(spriteId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  ).then((response) => response.sprite);
}

export function deleteCommunityCustomSprite(spriteId: string): Promise<CustomSpriteCatalogDeleteResponse> {
  return catalogRequest<CustomSpriteCatalogDeleteResponse>(
    `/api/custom-sprites/${encodeURIComponent(spriteId)}`,
    { method: 'DELETE' },
  );
}

function buildListQuery(options: CustomSpriteCatalogListOptions): string {
  const params = new URLSearchParams();
  append(params, 'query', options.query);
  append(params, 'kind', options.kind as CustomSpriteKind | null | undefined);
  append(params, 'cursor', options.cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function append(params: URLSearchParams, key: string, value: string | null | undefined): void {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized) params.set(key, normalized);
}

async function catalogRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const raw = (await response.text()).trim();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.trim()) message = parsed.error.trim();
    } catch {
      // Plain-text errors remain readable as-is.
    }
    message ||= `Request failed with status ${response.status}.`;
    throw new CustomSpriteCatalogApiError(message, response.status);
  }
  return (await response.json()) as T;
}
