import { jsonResponse, parsePositiveIntegerQueryParam, HttpError } from '../core/http';
import type { Env } from '../core/types';
import {
  listMusicPhrases,
  loadMusicPhrase,
  parseMusicPhraseInstrumentQuery,
} from './store';

export async function handleMusicPhraseListRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const instrumentId = parseMusicPhraseInstrumentQuery(url.searchParams.get('instrument'));
  const limit = parsePositiveIntegerQueryParam(url.searchParams, 'limit', 24, 1, 100);
  const cursor = url.searchParams.get('cursor');
  const response = await listMusicPhrases(env, {
    instrumentId,
    cursor,
    limit,
  });
  return jsonResponse(request, response);
}

export async function handleMusicPhraseGetRequest(
  request: Request,
  env: Env,
  phraseId: string,
): Promise<Response> {
  const trimmedId = phraseId.trim();
  if (!trimmedId) {
    throw new HttpError(400, 'Phrase id is required.');
  }

  const phrase = await loadMusicPhrase(env, trimmedId);
  if (!phrase) {
    throw new HttpError(404, 'Music phrase not found.');
  }

  return jsonResponse(request, { item: phrase });
}
