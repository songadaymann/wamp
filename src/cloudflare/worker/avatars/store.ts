import {
  buildCryptopunkAvatarId,
  type CryptopunkAvatarPackStatus,
  type CryptopunkAvatarPackSummary,
} from '../../../avatars/model';
import type { CryptopunkAvatarPackRow, Env } from '../core/types';

const VALID_STORED_STATUSES = new Set<CryptopunkAvatarPackStatus>([
  'queued',
  'generating',
  'ready',
  'failed',
]);

export async function loadCryptopunkAvatarPackRow(
  env: Env,
  punkId: number
): Promise<CryptopunkAvatarPackRow | null> {
  return env.DB.prepare(
    `
      SELECT
        punk_id,
        avatar_id,
        status,
        requested_by_user_id,
        request_count,
        generation_job_id,
        asset_base_url,
        manifest_url,
        head_image_url,
        base_texture_url,
        base_atlas_url,
        combat_texture_url,
        combat_atlas_url,
        punk_type,
        accessories_json,
        error_message,
        created_at,
        requested_at,
        generation_started_at,
        generated_at,
        updated_at
      FROM cryptopunk_avatar_packs
      WHERE punk_id = ?
      LIMIT 1
    `
  )
    .bind(punkId)
    .first<CryptopunkAvatarPackRow>();
}

export async function queueCryptopunkAvatarPack(
  env: Env,
  punkId: number,
  requestedByUserId: string
): Promise<CryptopunkAvatarPackRow> {
  const now = new Date().toISOString();
  const avatarId = buildCryptopunkAvatarId(punkId);

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO cryptopunk_avatar_packs (
          punk_id,
          avatar_id,
          status,
          requested_by_user_id,
          request_count,
          created_at,
          requested_at,
          updated_at
        )
        VALUES (?, ?, 'queued', ?, 1, ?, ?, ?)
        ON CONFLICT(punk_id) DO UPDATE SET
          request_count = cryptopunk_avatar_packs.request_count + 1,
          requested_at = excluded.requested_at,
          updated_at = excluded.updated_at,
          requested_by_user_id = COALESCE(cryptopunk_avatar_packs.requested_by_user_id, excluded.requested_by_user_id),
          status = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN 'queued'
            ELSE cryptopunk_avatar_packs.status
          END,
          error_message = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.error_message
          END,
          generation_job_id = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.generation_job_id
          END,
          generation_started_at = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.generation_started_at
          END,
          generated_at = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.generated_at
          END,
          asset_base_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.asset_base_url
          END,
          manifest_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.manifest_url
          END,
          head_image_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.head_image_url
          END,
          base_texture_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.base_texture_url
          END,
          base_atlas_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.base_atlas_url
          END,
          combat_texture_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.combat_texture_url
          END,
          combat_atlas_url = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.combat_atlas_url
          END,
          punk_type = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.punk_type
          END,
          accessories_json = CASE
            WHEN cryptopunk_avatar_packs.status = 'failed' THEN NULL
            ELSE cryptopunk_avatar_packs.accessories_json
          END
      `
    ).bind(punkId, avatarId, requestedByUserId, now, now, now),
  ]);

  const row = await loadCryptopunkAvatarPackRow(env, punkId);
  if (!row) {
    throw new Error(`Failed to queue CryptoPunk avatar pack ${punkId}.`);
  }
  return row;
}

export function mapCryptopunkAvatarPackRow(
  punkId: number,
  row: CryptopunkAvatarPackRow | null
): CryptopunkAvatarPackSummary {
  if (!row) {
    return {
      punkId,
      avatarId: buildCryptopunkAvatarId(punkId),
      status: 'missing',
      manifestUrl: null,
      headImageUrl: null,
      assetBaseUrl: null,
      punkType: null,
      accessories: [],
      requestedAt: null,
      generatedAt: null,
      updatedAt: null,
      errorMessage: null,
    };
  }

  return {
    punkId: row.punk_id,
    avatarId: row.avatar_id,
    status: normalizeStoredStatus(row.status),
    manifestUrl: row.manifest_url,
    headImageUrl: row.head_image_url,
    assetBaseUrl: row.asset_base_url,
    punkType: row.punk_type,
    accessories: parseAccessories(row.accessories_json),
    requestedAt: row.requested_at,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message,
  };
}

function normalizeStoredStatus(status: string): Exclude<CryptopunkAvatarPackStatus, 'missing'> {
  return VALID_STORED_STATUSES.has(status as CryptopunkAvatarPackStatus)
    ? (status as Exclude<CryptopunkAvatarPackStatus, 'missing'>)
    : 'failed';
}

function parseAccessories(rawValue: string | null): string[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}
