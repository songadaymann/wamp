import {
  CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
  CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER,
  MAX_CRYPTOPUNK_ID,
  MIN_CRYPTOPUNK_ID,
  parseCryptopunkAvatarId,
  type AvatarSelectionRequestBody,
  type AvatarSelectionResponse,
  type CryptopunkAvatarGenerateResponse,
  type CryptopunkAvatarStatusResponse,
} from '../../../avatars/model';
import { getRegisteredPlayerAvatarPack } from '../../../player/avatar/registry';
import { corsHeaders, HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, RequestAuth } from '../core/types';
import { updateUserSelectedAvatarId } from '../auth/store';
import {
  loadOptionalRequestAuth,
  requireAuthenticatedRequestAuth,
} from '../auth/request';
import { loadOrBackfillUserProgress } from '../progression/store';
import {
  getPlayerAvatarUnlockLevel,
  isPlayerAvatarEntitlementGated,
  isPlayerAvatarUnlockedForLevel,
} from '../../../player/avatar/unlocks';
import { hasUserAvatarEntitlement } from './entitlements';
import {
  loadCryptopunkAvatarPackRow,
  mapCryptopunkAvatarPackRow,
  queueCryptopunkAvatarPack,
} from './store';

export async function handleCryptopunkAvatarStatus(
  request: Request,
  env: Env,
  rawPunkId: string
): Promise<Response> {
  const punkId = parsePunkId(rawPunkId);
  const auth = await loadOptionalRequestAuth(env, request);
  const row = await loadCryptopunkAvatarPackRow(env, punkId);
  const pack = buildCryptopunkAvatarPackResponse(request, punkId, row);
  const viewerPlayerLevel = auth ? await loadPlayerLevel(env, auth.user.id, request) : null;

  const responseBody: CryptopunkAvatarStatusResponse = {
    pack,
    unlock: buildUnlockSummary(viewerPlayerLevel),
  };
  return jsonResponse(request, responseBody);
}

export async function handleCryptopunkAvatarGenerate(
  request: Request,
  env: Env,
  rawPunkId: string
): Promise<Response> {
  const punkId = parsePunkId(rawPunkId);
  const auth = await requireAuthenticatedRequestAuth(
    env,
    request,
    'generate CryptoPunk avatars'
  );
  await assertCryptopunkAvatarUnlocked(env, auth, request);

  const row = await queueCryptopunkAvatarPack(env, punkId, auth.user.id);
  const responseBody: CryptopunkAvatarGenerateResponse = {
    ok: true,
    pack: buildCryptopunkAvatarPackResponse(request, punkId, row),
  };
  return jsonResponse(request, responseBody);
}

export async function handleCryptopunkAvatarAsset(
  request: Request,
  env: Env,
  rawPunkId: string,
  rawAssetName: string
): Promise<Response> {
  const punkId = parsePunkId(rawPunkId);
  const assetName = normalizeCryptopunkAssetName(rawAssetName);
  const row = await loadCryptopunkAvatarPackRow(env, punkId);
  if (!row || row.status !== 'ready') {
    throw new HttpError(404, 'That CryptoPunk avatar is not generated yet.');
  }

  if (assetName === 'manifest.json') {
    return jsonResponse(
      request,
      buildCryptopunkManifestResponse(request, punkId, row)
    );
  }

  const sourceUrl = resolveCryptopunkAssetSourceUrl(row, assetName);
  if (!sourceUrl) {
    throw new HttpError(404, 'Avatar asset not found.');
  }

  const upstream = await fetch(sourceUrl, {
    headers: {
      Accept: request.headers.get('Accept') ?? '*/*',
    },
  });
  if (!upstream.ok || !upstream.body) {
    throw new HttpError(
      upstream.status === 404 ? 404 : 502,
      `Failed to load avatar asset ${assetName}.`
    );
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  const cacheControl = upstream.headers.get('cache-control');
  const etag = upstream.headers.get('etag');
  const lastModified = upstream.headers.get('last-modified');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  if (cacheControl) {
    headers.set('Cache-Control', cacheControl);
  }
  if (etag) {
    headers.set('ETag', etag);
  }
  if (lastModified) {
    headers.set('Last-Modified', lastModified);
  }
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}

export async function handleAvatarSelectionUpdate(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'change your avatar');
  const body = await parseJsonBody<Partial<AvatarSelectionRequestBody>>(request);
  const selectedAvatarId = normalizeSelectedAvatarId(body.selectedAvatarId);
  await assertAvatarCanBeSelected(env, auth, selectedAvatarId, request);
  await updateUserSelectedAvatarId(env, auth.user, selectedAvatarId);

  const responseBody: AvatarSelectionResponse = {
    ok: true,
    selectedAvatarId,
  };
  return jsonResponse(request, responseBody);
}

function parsePunkId(rawValue: string): number {
  if (!/^\d{1,4}$/.test(rawValue)) {
    throw new HttpError(400, 'CryptoPunk id must be a number from 0 to 9999.');
  }

  const punkId = Number(rawValue);
  if (punkId < MIN_CRYPTOPUNK_ID || punkId > MAX_CRYPTOPUNK_ID) {
    throw new HttpError(400, 'CryptoPunk id must be between 0 and 9999.');
  }
  return punkId;
}

function normalizeSelectedAvatarId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'selectedAvatarId is required.');
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new HttpError(400, 'selectedAvatarId is required.');
  }
  if (normalized.length > 128) {
    throw new HttpError(400, 'selectedAvatarId must be 128 characters or fewer.');
  }
  return normalized;
}

async function assertAvatarCanBeSelected(
  env: Env,
  auth: RequestAuth,
  selectedAvatarId: string,
  request: Request,
): Promise<void> {
  const cryptopunkId = parseCryptopunkAvatarId(selectedAvatarId);
  if (cryptopunkId !== null) {
    await assertCryptopunkAvatarUnlocked(env, auth, request);
    const row = await loadCryptopunkAvatarPackRow(env, cryptopunkId);
    if (!row || row.status !== 'ready') {
      throw new HttpError(409, 'That CryptoPunk avatar is not generated yet.');
    }
    return;
  }

  const registeredPack = getRegisteredPlayerAvatarPack(selectedAvatarId);
  if (!registeredPack) {
    throw new HttpError(400, 'Unknown avatar id.');
  }

  if (isPlayerAvatarEntitlementGated(selectedAvatarId)) {
    if (await hasUserAvatarEntitlement(env, auth.user.id, selectedAvatarId)) {
      return;
    }
    throw new HttpError(403, 'That prize avatar is not unlocked for this account.');
  }

  const playerLevel = registeredPack.kind === 'cryptopunk'
    ? await loadPlayerLevel(env, auth.user.id, request)
    : await loadRawPlayerLevel(env, auth.user.id);
  if (isPlayerAvatarUnlockedForLevel(selectedAvatarId, playerLevel)) {
    return;
  }

  const unlockLevel = getPlayerAvatarUnlockLevel(selectedAvatarId);
  if (unlockLevel) {
    throw new HttpError(403, `That avatar unlocks at Player LVL ${unlockLevel}.`);
  }
  throw new HttpError(403, 'That avatar is not unlockable yet.');
}

async function assertCryptopunkAvatarUnlocked(
  env: Env,
  auth: RequestAuth,
  request: Request,
): Promise<void> {
  const playerLevel = await loadPlayerLevel(env, auth.user.id, request);
  if (playerLevel < CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL) {
    throw new HttpError(
      403,
      `CryptoPunk avatars unlock at player level ${CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL}.`
    );
  }
}

async function loadPlayerLevel(env: Env, userId: string, request: Request): Promise<number> {
  const playerLevel = await loadRawPlayerLevel(env, userId);
  if (!isCryptopunkUnlockOverrideEnabled(request, env)) {
    return playerLevel;
  }

  return Math.max(playerLevel, CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL);
}

async function loadRawPlayerLevel(env: Env, userId: string): Promise<number> {
  const progress = await loadOrBackfillUserProgress(env, userId);
  return Number(progress.player_level) || 1;
}

function buildUnlockSummary(viewerPlayerLevel: number | null): CryptopunkAvatarStatusResponse['unlock'] {
  return {
    requiredPlayerLevel: CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
    viewerPlayerLevel,
    unlocked:
      viewerPlayerLevel !== null
      && viewerPlayerLevel >= CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL,
  };
}

function buildCryptopunkAvatarPackResponse(
  request: Request,
  punkId: number,
  row: Awaited<ReturnType<typeof loadCryptopunkAvatarPackRow>>
) {
  const pack = mapCryptopunkAvatarPackRow(punkId, row);
  if (!row) {
    return pack;
  }

  return {
    ...pack,
    manifestUrl: row.manifest_url ? buildCryptopunkAssetUrl(request, punkId, 'manifest.json') : null,
    headImageUrl: row.head_image_url ? buildCryptopunkAssetUrl(request, punkId, 'head.png') : null,
    assetBaseUrl: row.asset_base_url ? buildCryptopunkAssetBaseUrl(request, punkId) : null,
  };
}

function buildCryptopunkManifestResponse(
  request: Request,
  punkId: number,
  row: NonNullable<Awaited<ReturnType<typeof loadCryptopunkAvatarPackRow>>>
): Record<string, unknown> {
  const pack = buildCryptopunkAvatarPackResponse(request, punkId, row);

  return {
    version: 1,
    avatarId: pack.avatarId,
    punkId: pack.punkId,
    punkType: pack.punkType,
    accessories: pack.accessories,
    assetBaseUrl: pack.assetBaseUrl,
    headImageUrl: pack.headImageUrl,
    generatedAt: pack.generatedAt,
    assets: {
      baseAtlas: buildCryptopunkAssetUrl(request, punkId, 'PlayerSheet.json'),
      baseTexture: buildCryptopunkAssetUrl(request, punkId, 'PlayerSheet.png'),
      combatAtlas: buildCryptopunkAssetUrl(request, punkId, 'PlayerCombatActionsSheet.json'),
      combatTexture: buildCryptopunkAssetUrl(request, punkId, 'PlayerCombatActionsSheet.png'),
    },
  };
}

function normalizeCryptopunkAssetName(rawValue: string): string {
  const normalized = rawValue.trim();
  switch (normalized) {
    case 'manifest.json':
    case 'head.png':
    case 'PlayerSheet.json':
    case 'PlayerSheet.png':
    case 'PlayerCombatActionsSheet.json':
    case 'PlayerCombatActionsSheet.png':
      return normalized;
    default:
      throw new HttpError(404, 'Avatar asset not found.');
  }
}

function resolveCryptopunkAssetSourceUrl(
  row: NonNullable<Awaited<ReturnType<typeof loadCryptopunkAvatarPackRow>>>,
  assetName: string
): string | null {
  switch (assetName) {
    case 'head.png':
      return row.head_image_url;
    case 'PlayerSheet.json':
      return row.base_atlas_url;
    case 'PlayerSheet.png':
      return row.base_texture_url;
    case 'PlayerCombatActionsSheet.json':
      return row.combat_atlas_url;
    case 'PlayerCombatActionsSheet.png':
      return row.combat_texture_url;
    default:
      return null;
  }
}

function buildCryptopunkAssetBaseUrl(request: Request, punkId: number): string {
  return new URL(buildCryptopunkAssetPath(punkId), request.url).toString().replace(/\/+$/, '');
}

function buildCryptopunkAssetUrl(request: Request, punkId: number, assetName: string): string {
  return new URL(
    `${buildCryptopunkAssetPath(punkId)}/${encodeURIComponent(assetName)}`,
    request.url,
  ).toString();
}

function buildCryptopunkAssetPath(punkId: number): string {
  return `/api/avatars/cryptopunks/${punkId}/files`;
}

function isCryptopunkUnlockOverrideEnabled(request: Request, env: Env): boolean {
  if (request.headers.get(CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER) !== '1') {
    return false;
  }
  if (env.ENABLE_TEST_RESET !== '1') {
    return false;
  }

  const hostname = new URL(request.url).hostname.trim().toLowerCase();
  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === 'everybodys-platformer-safety.novox-robot.workers.dev'
  );
}
