import {
  CUSTOM_SPRITE_ACCOUNT_LIMIT,
  CUSTOM_SPRITE_CATALOG_DEFAULT_PAGE_SIZE,
  CUSTOM_SPRITE_CATALOG_MAX_PAGE_SIZE,
  type CustomSpriteCatalogEntry,
  type CustomSpriteCatalogListOptions,
  type CustomSpriteCatalogPage,
  type CustomSpriteCatalogStatus,
} from '../../../customSprites/catalog';
import {
  normalizeCustomSpriteDefinition,
  type CustomSpriteDefinition,
} from '../../../customSprites/model';
import type { AuthUser } from '../../../auth/model';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { isCustomSpriteUsedInStoredRooms } from './store';

interface CustomSpriteCatalogRow {
  id: string;
  owner_user_id: string | null;
  legacy_creator_label: string | null;
  definition_json: string;
  name: string;
  kind: string;
  size: number | string;
  status: string;
  revision: number | string;
  remixed_from_sprite_id: string | null;
  created_at: string;
  updated_at: string;
  owner_display_name: string | null;
  owner_username: string | null;
  remix_name: string | null;
  remix_creator_display_name: string | null;
  remix_legacy_creator_label: string | null;
}

interface ExistingCustomSpriteRow {
  owner_user_id: string | null;
  status: string;
  revision: number | string;
  created_at: string;
}

interface CustomSpriteCatalogCursor {
  updatedAt: string;
  id: string;
}

const CATALOG_SELECT = `
  SELECT
    sprites.id,
    sprites.owner_user_id,
    sprites.legacy_creator_label,
    sprites.definition_json,
    sprites.name,
    sprites.kind,
    sprites.size,
    sprites.status,
    sprites.revision,
    sprites.remixed_from_sprite_id,
    sprites.created_at,
    sprites.updated_at,
    owner.display_name AS owner_display_name,
    owner.username AS owner_username,
    remix.name AS remix_name,
    remix_owner.display_name AS remix_creator_display_name,
    remix.legacy_creator_label AS remix_legacy_creator_label
  FROM custom_sprites AS sprites
  LEFT JOIN users AS owner ON owner.id = sprites.owner_user_id
  LEFT JOIN custom_sprites AS remix ON remix.id = sprites.remixed_from_sprite_id
  LEFT JOIN users AS remix_owner ON remix_owner.id = remix.owner_user_id
`;

export async function listPublicCustomSprites(
  env: Env,
  options: CustomSpriteCatalogListOptions,
): Promise<CustomSpriteCatalogPage> {
  return listCustomSprites(env, options, null, 'active');
}

export async function listOwnedCustomSprites(
  env: Env,
  ownerUserId: string,
  options: CustomSpriteCatalogListOptions,
): Promise<CustomSpriteCatalogPage> {
  return listCustomSprites(env, options, ownerUserId, 'active');
}

export async function listAdminCustomSprites(
  env: Env,
  options: CustomSpriteCatalogListOptions,
  status: Extract<CustomSpriteCatalogStatus, 'active' | 'blocked'>,
): Promise<CustomSpriteCatalogPage> {
  return listCustomSprites(env, options, null, status);
}

async function listCustomSprites(
  env: Env,
  options: CustomSpriteCatalogListOptions,
  ownerUserId: string | null,
  status: Extract<CustomSpriteCatalogStatus, 'active' | 'blocked'>,
): Promise<CustomSpriteCatalogPage> {
  const limit = normalizePageLimit(options.limit);
  const cursor = decodeCatalogCursor(options.cursor ?? null);
  const query = normalizeCatalogQuery(options.query);
  const queryPattern = query ? `%${escapeLike(query)}%` : null;
  const kind = options.kind ?? null;
  const result = await env.DB.prepare(
    `${CATALOG_SELECT}
      WHERE sprites.status = ?
        AND (? IS NULL OR sprites.owner_user_id = ?)
        AND (? IS NULL OR sprites.kind = ?)
        AND (
          ? IS NULL
          OR sprites.normalized_name LIKE ? ESCAPE '\\'
          OR LOWER(COALESCE(owner.display_name, sprites.legacy_creator_label, '')) LIKE ? ESCAPE '\\'
          OR LOWER(COALESCE(owner.username, '')) LIKE ? ESCAPE '\\'
        )
        AND (
          ? IS NULL
          OR sprites.updated_at < ?
          OR (sprites.updated_at = ? AND sprites.id < ?)
        )
      ORDER BY sprites.updated_at DESC, sprites.id DESC
      LIMIT ?
    `,
  )
    .bind(
      status,
      ownerUserId,
      ownerUserId,
      kind,
      kind,
      queryPattern,
      queryPattern,
      queryPattern,
      queryPattern,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    )
    .all<CustomSpriteCatalogRow>();

  const hasMore = result.results.length > limit;
  const pageRows = result.results.slice(0, limit);
  const sprites = pageRows.map(materializeCatalogEntry);
  const lastRow = pageRows[pageRows.length - 1] ?? null;
  return {
    sprites,
    nextCursor: hasMore && lastRow
      ? encodeCatalogCursor({ updatedAt: lastRow.updated_at, id: lastRow.id })
      : null,
  };
}

export async function loadCustomSpriteCatalogEntry(
  env: Env,
  spriteId: string,
  includeHidden = false,
): Promise<CustomSpriteCatalogEntry | null> {
  const row = await env.DB.prepare(
    `${CATALOG_SELECT}
      WHERE sprites.id = ?
        AND (? = 1 OR sprites.status = 'active')
      LIMIT 1
    `,
  )
    .bind(spriteId, includeHidden ? 1 : 0)
    .first<CustomSpriteCatalogRow>();
  return row ? materializeCatalogEntry(row) : null;
}

export async function saveCustomSpriteCatalogEntry(
  env: Env,
  owner: AuthUser,
  input: {
    spriteId: string;
    definition: unknown;
    expectedRevision?: number | null;
    remixedFromSpriteId?: string | null;
  },
): Promise<CustomSpriteCatalogEntry> {
  const normalized = normalizeCustomSpriteDefinition(input.definition);
  if (!normalized || normalized.id !== input.spriteId) {
    throw new HttpError(400, 'definition must contain the matching custom sprite id.');
  }

  const existing = await env.DB.prepare(
    `SELECT owner_user_id, status, revision, created_at FROM custom_sprites WHERE id = ? LIMIT 1`,
  )
    .bind(input.spriteId)
    .first<ExistingCustomSpriteRow>();
  if (existing) {
    if (existing.owner_user_id !== owner.id) {
      throw new HttpError(403, 'This custom sprite belongs to another creator.');
    }
    if (existing.status !== 'active') {
      throw new HttpError(403, 'This custom sprite is not editable.');
    }
    if (normalizeRevision(existing.revision) !== input.expectedRevision) {
      throw new HttpError(409, 'This custom sprite changed on another device. Reload it before saving.');
    }
  } else {
    if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
      throw new HttpError(409, 'This custom sprite no longer exists. Save it as a remix instead.');
    }
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM custom_sprites WHERE owner_user_id = ? AND status = 'active'`,
    )
      .bind(owner.id)
      .first<{ count: number | string }>();
    if (Number(countRow?.count ?? 0) >= CUSTOM_SPRITE_ACCOUNT_LIMIT) {
      throw new HttpError(409, `Each account can share up to ${CUSTOM_SPRITE_ACCOUNT_LIMIT} active sprites.`);
    }
  }

  const remixedFromSpriteId = normalizeOptionalSpriteId(input.remixedFromSpriteId);
  if (remixedFromSpriteId) {
    const remixSource = await env.DB.prepare(
      `SELECT id FROM custom_sprites WHERE id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(remixedFromSpriteId)
      .first<{ id: string }>();
    if (!remixSource) {
      throw new HttpError(400, 'The remix source is not available.');
    }
  }

  const now = new Date().toISOString();
  const nextRevision = existing ? normalizeRevision(existing.revision) + 1 : 1;
  const definition: CustomSpriteDefinition = {
    ...normalized,
    status: 'active',
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  };
  await env.DB.prepare(
    `
      INSERT INTO custom_sprites (
        id,
        owner_user_id,
        legacy_creator_label,
        definition_json,
        name,
        normalized_name,
        kind,
        size,
        status,
        revision,
        remixed_from_sprite_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        definition_json = excluded.definition_json,
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        kind = excluded.kind,
        size = excluded.size,
        revision = excluded.revision,
        remixed_from_sprite_id = COALESCE(custom_sprites.remixed_from_sprite_id, excluded.remixed_from_sprite_id),
        updated_at = excluded.updated_at
      WHERE custom_sprites.owner_user_id = ?
        AND custom_sprites.status = 'active'
        AND custom_sprites.revision = ?
    `,
  )
    .bind(
      input.spriteId,
      owner.id,
      JSON.stringify(definition),
      definition.name,
      definition.name.toLowerCase(),
      definition.kind,
      definition.size,
      nextRevision,
      remixedFromSpriteId,
      definition.createdAt,
      now,
      owner.id,
      existing ? normalizeRevision(existing.revision) : 0,
    )
    .all();

  const saved = await loadCustomSpriteCatalogEntry(env, input.spriteId, true);
  if (!saved) {
    throw new HttpError(500, 'Custom sprite was saved but could not be reloaded.');
  }
  if (saved.creator.userId !== owner.id) {
    throw new HttpError(403, 'This custom sprite belongs to another creator.');
  }
  if (saved.revision !== nextRevision || !sameSpriteContent(saved.sprite, definition)) {
    throw new HttpError(409, 'This custom sprite changed on another device. Reload it before saving.');
  }
  return saved;
}

export async function deleteOwnedCustomSprite(
  env: Env,
  ownerUserId: string,
  spriteId: string,
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT owner_user_id, status, revision, created_at FROM custom_sprites WHERE id = ? LIMIT 1`,
  )
    .bind(spriteId)
    .first<ExistingCustomSpriteRow>();
  if (!existing || existing.status === 'deleted') {
    throw new HttpError(404, 'Custom sprite not found.');
  }
  if (existing.owner_user_id !== ownerUserId) {
    throw new HttpError(403, 'Only the creator can delete this custom sprite.');
  }
  if (await isCustomSpriteUsedInStoredRooms(env, spriteId)) {
    throw new HttpError(409, 'This custom sprite is used in a room.');
  }

  await env.DB.prepare(
    `UPDATE custom_sprites SET status = 'deleted', updated_at = ? WHERE id = ? AND owner_user_id = ?`,
  )
    .bind(new Date().toISOString(), spriteId, ownerUserId)
    .all();
}

export async function moderateCustomSprite(
  env: Env,
  spriteId: string,
  status: Extract<CustomSpriteCatalogStatus, 'active' | 'blocked'>,
): Promise<CustomSpriteCatalogEntry> {
  const existing = await loadCustomSpriteCatalogEntry(env, spriteId, true);
  if (!existing || existing.status === 'deleted') {
    throw new HttpError(404, 'Custom sprite not found.');
  }
  await env.DB.prepare(
    `UPDATE custom_sprites SET status = ?, updated_at = ? WHERE id = ? AND status <> 'deleted'`,
  )
    .bind(status, new Date().toISOString(), spriteId)
    .all();
  const updated = await loadCustomSpriteCatalogEntry(env, spriteId, true);
  if (!updated) {
    throw new HttpError(500, 'Custom sprite moderation state could not be reloaded.');
  }
  return updated;
}

function materializeCatalogEntry(row: CustomSpriteCatalogRow): CustomSpriteCatalogEntry {
  let rawDefinition: unknown;
  try {
    rawDefinition = JSON.parse(row.definition_json);
  } catch {
    throw new HttpError(500, 'Stored custom sprite definition is invalid.');
  }
  const sprite = normalizeCustomSpriteDefinition(rawDefinition);
  if (!sprite || sprite.id !== row.id) {
    throw new HttpError(500, 'Stored custom sprite definition is invalid.');
  }
  sprite.status = row.status === 'blocked' ? 'blocked' : 'active';
  sprite.createdAt = row.created_at;
  sprite.updatedAt = row.updated_at;

  const creatorDisplayName = row.owner_display_name?.trim()
    || row.legacy_creator_label?.trim()
    || 'Legacy creator';
  return {
    sprite,
    revision: normalizeRevision(row.revision),
    status: normalizeCatalogStatus(row.status),
    creator: {
      userId: row.owner_user_id,
      displayName: creatorDisplayName,
      username: row.owner_username?.trim() || null,
      legacy: !row.owner_user_id,
    },
    remixedFrom: row.remixed_from_sprite_id
      ? {
          spriteId: row.remixed_from_sprite_id,
          name: row.remix_name?.trim() || 'Custom sprite',
          creatorDisplayName:
            row.remix_creator_display_name?.trim()
            || row.remix_legacy_creator_label?.trim()
            || 'Legacy creator',
        }
      : null,
  };
}

function normalizeCatalogStatus(value: string): CustomSpriteCatalogStatus {
  if (value === 'blocked' || value === 'deleted') return value;
  return 'active';
}

function normalizeRevision(value: number | string): number {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 1;
}

function normalizePageLimit(value: number | undefined): number {
  const limit = Math.floor(Number(value));
  if (!Number.isFinite(limit) || limit <= 0) return CUSTOM_SPRITE_CATALOG_DEFAULT_PAGE_SIZE;
  return Math.min(CUSTOM_SPRITE_CATALOG_MAX_PAGE_SIZE, limit);
}

function normalizeCatalogQuery(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const query = value.trim().toLowerCase().slice(0, 64);
  return query || null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeOptionalSpriteId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id || null;
}

function sameSpriteContent(left: CustomSpriteDefinition, right: CustomSpriteDefinition): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.size === right.size
    && left.kind === right.kind
    && left.pixels.length === right.pixels.length
    && left.pixels.every((pixel, index) => pixel === right.pixels[index]);
}

function encodeCatalogCursor(cursor: CustomSpriteCatalogCursor): string {
  return btoa(JSON.stringify({ version: 1, updatedAt: cursor.updatedAt, id: cursor.id }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeCatalogCursor(value: string | null): CustomSpriteCatalogCursor | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded)) as {
      version?: unknown;
      updatedAt?: unknown;
      id?: unknown;
    };
    if (
      parsed.version !== 1
      || typeof parsed.updatedAt !== 'string'
      || Number.isNaN(Date.parse(parsed.updatedAt))
      || typeof parsed.id !== 'string'
      || !parsed.id
    ) {
      throw new Error('invalid cursor');
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new HttpError(400, 'Invalid custom sprite cursor.');
  }
}
