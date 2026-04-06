import { getApiBaseUrl } from '../api/baseUrl';
import type { RoomSnapshot } from '../persistence/roomModel';
import type { RoomPatternInstrumentId } from './pattern';
import {
  cloneMusicPhraseRecord,
  type MusicPhraseListResponse,
  type MusicPhraseRecord,
  type MusicPhraseSaveResponse,
} from './library';

type ListMusicPhrasesOptions = {
  instrumentId: RoomPatternInstrumentId;
  cursor?: string | null;
  limit?: number;
};

const phrasePromiseCache = new Map<string, Promise<MusicPhraseRecord>>();

function getMusicApiUrl(path: string): string {
  const base = getApiBaseUrl();
  return `${base}${path}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Music request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function listMusicPhrases(
  options: ListMusicPhrasesOptions,
): Promise<MusicPhraseListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('instrument', options.instrumentId);
  if (options.cursor) {
    searchParams.set('cursor', options.cursor);
  }
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    searchParams.set('limit', String(Math.max(1, Math.min(100, Math.floor(options.limit)))));
  }
  searchParams.set('_ts', String(Date.now()));

  const response = await fetch(getMusicApiUrl(`/api/music/phrases?${searchParams.toString()}`), {
    cache: 'no-store',
    credentials: 'include',
  });
  const payload = await parseJsonResponse<MusicPhraseListResponse>(response);
  const items = payload.items
    .map((item) => cloneMusicPhraseRecord(item))
    .filter((item): item is MusicPhraseRecord => item !== null);

  for (const item of items) {
    phrasePromiseCache.set(item.id, Promise.resolve(item));
  }

  return {
    items,
    nextCursor: typeof payload.nextCursor === 'string' && payload.nextCursor.trim()
      ? payload.nextCursor
      : null,
  };
}

export async function getMusicPhrase(id: string): Promise<MusicPhraseRecord> {
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error('Phrase id is required.');
  }

  const cached = phrasePromiseCache.get(trimmedId);
  if (cached) {
    return cached;
  }

  const promise = fetch(getMusicApiUrl(`/api/music/phrases/${encodeURIComponent(trimmedId)}`), {
    credentials: 'include',
  })
    .then((response) => parseJsonResponse<{ item: MusicPhraseRecord }>(response))
    .then((payload) => {
      const phrase = cloneMusicPhraseRecord(payload.item);
      if (!phrase) {
        throw new Error('Phrase payload was invalid.');
      }
      return phrase;
    });

  phrasePromiseCache.set(trimmedId, promise);
  return promise;
}

export async function loadMusicPhrasesById(
  ids: readonly string[],
): Promise<Map<string, MusicPhraseRecord>> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const phrases = await Promise.all(uniqueIds.map((id) => getMusicPhrase(id)));
  return new Map(phrases.map((phrase) => [phrase.id, phrase]));
}

export async function saveMusicPhrases(
  snapshot: RoomSnapshot,
  options?: { instrumentId?: RoomPatternInstrumentId | null },
): Promise<MusicPhraseSaveResponse> {
  const searchParams = new URLSearchParams();
  if (options?.instrumentId) {
    searchParams.set('instrument', options.instrumentId);
  }
  searchParams.set('_ts', String(Date.now()));
  const path = `/api/rooms/${encodeURIComponent(snapshot.id)}/music/phrases?${searchParams.toString()}`;
  const response = await fetch(getMusicApiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(snapshot),
  });
  const payload = await parseJsonResponse<MusicPhraseSaveResponse>(response);
  const items = payload.items
    .map((item) => cloneMusicPhraseRecord(item))
    .filter((item): item is MusicPhraseRecord => item !== null);

  for (const item of items) {
    phrasePromiseCache.set(item.id, Promise.resolve(item));
  }

  return { items };
}
