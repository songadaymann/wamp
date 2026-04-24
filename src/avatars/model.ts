export const CRYPTOPUNK_AVATAR_UNLOCK_PLAYER_LEVEL = 10;
export const CRYPTOPUNK_AVATAR_ID_PREFIX = 'cryptopunk-';
export const MIN_CRYPTOPUNK_ID = 0;
export const MAX_CRYPTOPUNK_ID = 9999;
export const CRYPTOPUNK_UNLOCK_OVERRIDE_HEADER = 'X-Debug-Force-Cryptopunk-Unlock';

export type CryptopunkAvatarPackStatus =
  | 'missing'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed';

export interface CryptopunkAvatarPackSummary {
  punkId: number;
  avatarId: string;
  status: CryptopunkAvatarPackStatus;
  manifestUrl: string | null;
  headImageUrl: string | null;
  assetBaseUrl: string | null;
  punkType: string | null;
  accessories: string[];
  requestedAt: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  errorMessage: string | null;
}

export interface CryptopunkAvatarStatusResponse {
  pack: CryptopunkAvatarPackSummary;
  unlock: {
    requiredPlayerLevel: number;
    viewerPlayerLevel: number | null;
    unlocked: boolean;
  };
}

export interface CryptopunkAvatarGenerateResponse {
  ok: true;
  pack: CryptopunkAvatarPackSummary;
}

export interface AvatarSelectionRequestBody {
  selectedAvatarId: string;
}

export interface AvatarSelectionResponse {
  ok: true;
  selectedAvatarId: string;
}

export function buildCryptopunkAvatarId(punkId: number): string {
  return `${CRYPTOPUNK_AVATAR_ID_PREFIX}${punkId}`;
}

export function parseCryptopunkAvatarId(avatarId: string): number | null {
  if (!avatarId.startsWith(CRYPTOPUNK_AVATAR_ID_PREFIX)) {
    return null;
  }

  const rawPunkId = avatarId.slice(CRYPTOPUNK_AVATAR_ID_PREFIX.length);
  if (!/^\d{1,4}$/.test(rawPunkId)) {
    return null;
  }

  const punkId = Number(rawPunkId);
  return punkId >= MIN_CRYPTOPUNK_ID && punkId <= MAX_CRYPTOPUNK_ID ? punkId : null;
}
