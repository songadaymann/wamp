import type { RoomSnapshot } from '../../../persistence/roomModel';
import {
  cloneMusicPhrasePayload,
  cloneMusicPhraseRecord,
  createMusicPhraseLabel,
  extractMusicPhrasePayloadFromPattern,
  getMusicPhraseFingerprint,
  getMusicPhraseSampleName,
  type MusicPhraseListResponse,
  type MusicPhrasePayload,
  type MusicPhraseRecord,
  type MusicPhraseSaveResponse,
} from '../../../music/library';
import {
  normalizeRoomMusicKeyMode,
  normalizeRoomMusicKeyTonic,
} from '../../../music/key';
import { isPatternRoomMusic } from '../../../music/model';
import {
  ROOM_PATTERN_INSTRUMENT_IDS,
  type RoomPatternInstrumentId,
} from '../../../music/pattern';
import { HttpError } from '../core/http';
import type {
  D1PreparedStatement,
  Env,
  MusicPhraseJoinRow,
} from '../core/types';

export interface MusicPhrasePublishActor {
  userId: string | null;
  principalKind: 'user' | 'agent';
  agentId: string | null;
  displayName: string;
}

type MusicPhraseCursor = {
  createdAt: string;
  id: string;
};

type LatestMusicPhraseSummary = {
  id: string;
  ordinal: number;
  fingerprint: string;
  label: string;
} | null;

const INSERT_MUSIC_PHRASE_BATCH_SQL = `
  INSERT INTO music_phrase_batches (
    id,
    room_id,
    room_version,
    room_title,
    room_x,
    room_y,
    creator_user_id,
    creator_principal_type,
    creator_agent_id,
    creator_display_name,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_MUSIC_PHRASE_SQL = `
  INSERT INTO music_phrases (
    id,
    batch_id,
    room_id,
    room_version,
    room_title,
    room_x,
    room_y,
    creator_user_id,
    creator_principal_type,
    creator_agent_id,
    creator_display_name,
    instrument_id,
    ordinal,
    label,
    fingerprint,
    payload_json,
    source_key_tonic,
    source_key_mode,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_MUSIC_PHRASE_SOURCE_SQL = `
  INSERT INTO music_phrase_sources (
    child_phrase_id,
    source_phrase_id,
    created_at
  )
  VALUES (?, ?, ?)
  ON CONFLICT(child_phrase_id, source_phrase_id) DO NOTHING
`;

const DELETE_MUSIC_PHRASE_SOURCES_SQL = `
  DELETE FROM music_phrase_sources
  WHERE child_phrase_id = ?
`;

const DELETE_MUSIC_PHRASE_SOURCE_REFERENCES_SQL = `
  DELETE FROM music_phrase_sources
  WHERE source_phrase_id = ?
`;

const DELETE_MUSIC_PHRASE_SQL = `
  DELETE FROM music_phrases
  WHERE id = ?
`;

const DELETE_EMPTY_MUSIC_PHRASE_BATCH_SQL = `
  DELETE FROM music_phrase_batches
  WHERE id = ?
    AND NOT EXISTS (
      SELECT 1
      FROM music_phrases
      WHERE batch_id = ?
      LIMIT 1
    )
`;

const UPDATE_MUSIC_PHRASE_LABEL_SQL = `
  UPDATE music_phrases
  SET
    room_version = ?,
    room_title = ?,
    room_x = ?,
    room_y = ?,
    creator_display_name = ?,
    label = ?,
    fingerprint = ?,
    payload_json = ?,
    source_key_tonic = ?,
    source_key_mode = ?
  WHERE room_id = ? AND instrument_id = ? AND ordinal = ?
`;

const UPDATE_MUSIC_PHRASE_BY_ID_SQL = `
  UPDATE music_phrases
  SET
    room_version = ?,
    room_title = ?,
    room_x = ?,
    room_y = ?,
    creator_display_name = ?,
    label = ?,
    fingerprint = ?,
    payload_json = ?,
    source_key_tonic = ?,
    source_key_mode = ?
  WHERE id = ?
`;

function normalizeMusicPhraseInstrumentId(value: unknown): RoomPatternInstrumentId {
  if (value === 'drums' || value === 'triangle' || value === 'saw' || value === 'square') {
    return value;
  }

  throw new HttpError(400, 'instrument must be one of drums, triangle, saw, or square.');
}

function encodeMusicPhraseCursor(cursor: MusicPhraseCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

function decodeMusicPhraseCursor(value: string | null): MusicPhraseCursor | null {
  if (!value || !value.trim()) {
    return null;
  }

  const separatorIndex = value.lastIndexOf('|');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    throw new HttpError(400, 'cursor is invalid.');
  }

  const createdAt = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1);
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new HttpError(400, 'cursor is invalid.');
  }

  return { createdAt, id };
}

function parseMusicPhrasePayload(raw: string): MusicPhrasePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(500, 'Stored music phrase payload is invalid.');
  }

  const payload = cloneMusicPhrasePayload(parsed as MusicPhrasePayload | null);
  if (!payload) {
    throw new HttpError(500, 'Stored music phrase payload is invalid.');
  }

  return payload;
}

function parseSourcePhraseIds(csv: string | null): string[] {
  if (!csv) {
    return [];
  }

  const seen = new Set<string>();
  for (const value of csv.split(',')) {
    const trimmed = value.trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

function materializeMusicPhraseRecord(row: MusicPhraseJoinRow): MusicPhraseRecord {
  const record = cloneMusicPhraseRecord({
    id: row.id,
    batchId: row.batch_id,
    roomId: row.room_id,
    roomVersion: row.room_version,
    roomTitle: row.room_title,
    roomX: row.room_x,
    roomY: row.room_y,
    creatorUserId: row.creator_user_id,
    creatorPrincipalKind: row.creator_principal_type,
    creatorAgentId: row.creator_agent_id,
    creatorDisplayName: row.creator_display_name,
    instrumentId: normalizeMusicPhraseInstrumentId(row.instrument_id),
    ordinal: row.ordinal,
    label: row.label,
    fingerprint: row.fingerprint,
    payload: parseMusicPhrasePayload(row.payload_json),
    sourceKeyTonic: row.source_key_tonic ? normalizeRoomMusicKeyTonic(row.source_key_tonic) : null,
    sourceKeyMode: row.source_key_mode ? normalizeRoomMusicKeyMode(row.source_key_mode) : null,
    sourcePhraseIds: parseSourcePhraseIds(row.source_phrase_ids_csv),
    createdAt: row.created_at,
  });

  if (!record) {
    throw new HttpError(500, 'Stored music phrase record is invalid.');
  }

  return record;
}

async function loadLatestMusicPhraseSummary(
  env: Env,
  roomId: string,
  instrumentId: RoomPatternInstrumentId,
): Promise<LatestMusicPhraseSummary> {
  const row = await env.DB.prepare(
    `
      SELECT id, ordinal, fingerprint, label
      FROM music_phrases
      WHERE room_id = ?
        AND instrument_id = ?
      ORDER BY ordinal DESC
      LIMIT 1
    `,
  )
    .bind(roomId, instrumentId)
    .first<{ id: string | null; ordinal: number | string | null; fingerprint: string | null; label: string | null }>();

  if (!row || typeof row.id !== 'string' || typeof row.fingerprint !== 'string') {
    return null;
  }

  return {
    id: row.id,
    ordinal: Math.max(0, Number(row.ordinal ?? 0)),
    fingerprint: row.fingerprint,
    label: row.label?.trim() ?? '',
  };
}

async function loadExistingMusicPhraseBatchId(
  env: Env,
  roomId: string,
  roomVersion: number,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `
      SELECT id
      FROM music_phrase_batches
      WHERE room_id = ?
        AND room_version = ?
      LIMIT 1
    `,
  )
    .bind(roomId, roomVersion)
    .first<{ id: string | null }>();

  return row && typeof row.id === 'string' && row.id.trim() ? row.id : null;
}

function normalizeInstrumentIdFilter(
  instrumentIds: readonly RoomPatternInstrumentId[] | null | undefined,
): RoomPatternInstrumentId[] {
  if (!instrumentIds || instrumentIds.length === 0) {
    return [...ROOM_PATTERN_INSTRUMENT_IDS];
  }

  const allowed = new Set<RoomPatternInstrumentId>(ROOM_PATTERN_INSTRUMENT_IDS);
  const seen = new Set<RoomPatternInstrumentId>();
  for (const instrumentId of instrumentIds) {
    if (allowed.has(instrumentId)) {
      seen.add(instrumentId);
    }
  }

  return ROOM_PATTERN_INSTRUMENT_IDS.filter((instrumentId) => seen.has(instrumentId));
}

function resolveMusicPhraseNameSuffix(
  requestedNameSuffix: string | null | undefined,
  fallbackLabel: string | null | undefined,
): string | null {
  const trimmedRequested = typeof requestedNameSuffix === 'string' ? requestedNameSuffix.trim() : '';
  if (trimmedRequested) {
    return trimmedRequested;
  }

  const trimmedLabel = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
  if (!trimmedLabel) {
    return null;
  }

  const sampleName = getMusicPhraseSampleName({ label: trimmedLabel }).trim();
  return sampleName || null;
}

function buildMusicPhraseSourceIdsForWrite(
  sourcePhraseIds: readonly string[],
  targetPhraseId?: string | null,
): string[] {
  const trimmedTargetPhraseId = typeof targetPhraseId === 'string' ? targetPhraseId.trim() : '';
  const seen = new Set<string>();
  const next: string[] = [];
  for (const sourcePhraseId of sourcePhraseIds) {
    const trimmed = sourcePhraseId.trim();
    if (!trimmed || trimmed === trimmedTargetPhraseId || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export async function upsertMusicPhrasesForSnapshot(
  env: Env,
  snapshot: RoomSnapshot,
  actor: MusicPhrasePublishActor,
  options?: {
    instrumentIds?: readonly RoomPatternInstrumentId[] | null;
    saveMode?: 'overwrite' | 'save-as';
    overwritePhraseId?: string | null;
  },
): Promise<MusicPhraseSaveResponse> {
  if (!isPatternRoomMusic(snapshot.music)) {
    return { items: [] };
  }

  const pattern = snapshot.music;
  const createdAt = snapshot.updatedAt ?? new Date().toISOString();
  const creatorDisplayName = actor.displayName.trim() || 'Guest';
  const instrumentIds = normalizeInstrumentIdFilter(options?.instrumentIds);
  const statements: D1PreparedStatement[] = [];
  const savedPhraseIds: string[] = [];
  let batchId = await loadExistingMusicPhraseBatchId(env, snapshot.id, snapshot.version);
  const requestedOverwritePhraseId = options?.overwritePhraseId?.trim() || null;

  for (const instrumentId of instrumentIds) {
    const payload = extractMusicPhrasePayloadFromPattern(pattern, instrumentId);
    if (!payload) {
      continue;
    }

    const fingerprint = getMusicPhraseFingerprint(payload);
    const latestPhrase = await loadLatestMusicPhraseSummary(env, snapshot.id, instrumentId);
    const sourcePhraseIds = pattern.sourcePhraseIds[instrumentId];
    const sourceKeyTonic = payload.kind === 'tonal' ? payload.keyTonic : null;
    const sourceKeyMode = payload.kind === 'tonal' ? payload.keyMode : null;
    const shouldCreateNewVersion = options?.saveMode === 'save-as';

    if (options?.saveMode === 'overwrite' && requestedOverwritePhraseId) {
      const targetPhrase = await loadMusicPhrase(env, requestedOverwritePhraseId);
      if (!targetPhrase) {
        throw new HttpError(404, 'Music phrase not found.');
      }
      if (!actor.userId || targetPhrase.creatorUserId !== actor.userId) {
        throw new HttpError(403, 'Only the phrase creator can overwrite this phrase.');
      }
      if (targetPhrase.roomId !== snapshot.id || targetPhrase.instrumentId !== instrumentId) {
        throw new HttpError(400, 'overwritePhraseId does not match the active room phrase.');
      }

      const desiredLabel = createMusicPhraseLabel(
        creatorDisplayName,
        snapshot.title,
        snapshot.coordinates,
        instrumentId,
        targetPhrase.ordinal,
        resolveMusicPhraseNameSuffix(
          pattern.phraseNameSuffixes[instrumentId] ?? null,
          targetPhrase.label,
        ),
      );
      const nextSourcePhraseIds = buildMusicPhraseSourceIdsForWrite(sourcePhraseIds, targetPhrase.id);
      statements.push(
        env.DB.prepare(UPDATE_MUSIC_PHRASE_BY_ID_SQL).bind(
          snapshot.version,
          snapshot.title,
          snapshot.coordinates.x,
          snapshot.coordinates.y,
          creatorDisplayName,
          desiredLabel,
          fingerprint,
          JSON.stringify(payload),
          sourceKeyTonic,
          sourceKeyMode,
          targetPhrase.id,
        ),
      );
      statements.push(
        env.DB.prepare(DELETE_MUSIC_PHRASE_SOURCES_SQL).bind(targetPhrase.id),
      );
      for (const sourcePhraseId of nextSourcePhraseIds) {
        statements.push(
          env.DB.prepare(INSERT_MUSIC_PHRASE_SOURCE_SQL).bind(
            targetPhrase.id,
            sourcePhraseId,
            createdAt,
          ),
        );
      }
      savedPhraseIds.push(targetPhrase.id);
      continue;
    }

    const desiredOrdinal =
      !shouldCreateNewVersion && latestPhrase && latestPhrase.fingerprint === fingerprint
        ? latestPhrase.ordinal
        : latestPhrase
          ? latestPhrase.ordinal + 1
          : 0;
    const desiredLabel = createMusicPhraseLabel(
      creatorDisplayName,
      snapshot.title,
      snapshot.coordinates,
      instrumentId,
      desiredOrdinal,
      resolveMusicPhraseNameSuffix(
        pattern.phraseNameSuffixes[instrumentId] ?? null,
        !shouldCreateNewVersion && latestPhrase && latestPhrase.fingerprint === fingerprint
          ? latestPhrase.label
          : null,
      ),
    );

    if (!shouldCreateNewVersion && latestPhrase && latestPhrase.fingerprint === fingerprint) {
      const nextSourcePhraseIds = buildMusicPhraseSourceIdsForWrite(sourcePhraseIds, latestPhrase.id);
      statements.push(
        env.DB.prepare(UPDATE_MUSIC_PHRASE_LABEL_SQL).bind(
          snapshot.version,
          snapshot.title,
          snapshot.coordinates.x,
          snapshot.coordinates.y,
          creatorDisplayName,
          desiredLabel,
          fingerprint,
          JSON.stringify(payload),
          sourceKeyTonic,
          sourceKeyMode,
          snapshot.id,
          instrumentId,
          latestPhrase.ordinal,
        ),
      );
      statements.push(
        env.DB.prepare(DELETE_MUSIC_PHRASE_SOURCES_SQL).bind(latestPhrase.id),
      );
      for (const sourcePhraseId of nextSourcePhraseIds) {
        statements.push(
          env.DB.prepare(INSERT_MUSIC_PHRASE_SOURCE_SQL).bind(
            latestPhrase.id,
            sourcePhraseId,
            createdAt,
          ),
        );
      }
      savedPhraseIds.push(latestPhrase.id);
      continue;
    }

    if (!batchId) {
      batchId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(INSERT_MUSIC_PHRASE_BATCH_SQL).bind(
          batchId,
          snapshot.id,
          snapshot.version,
          snapshot.title,
          snapshot.coordinates.x,
          snapshot.coordinates.y,
          actor.userId,
          actor.principalKind,
          actor.agentId,
          creatorDisplayName,
          createdAt,
        ),
      );
    }

    const phraseId = crypto.randomUUID();
    const phrase = cloneMusicPhraseRecord({
      id: phraseId,
      batchId,
      roomId: snapshot.id,
      roomVersion: snapshot.version,
      roomTitle: snapshot.title,
      roomX: snapshot.coordinates.x,
      roomY: snapshot.coordinates.y,
      creatorUserId: actor.userId,
      creatorPrincipalKind: actor.principalKind,
      creatorAgentId: actor.agentId,
      creatorDisplayName,
      instrumentId,
      ordinal: desiredOrdinal,
      label: desiredLabel,
      fingerprint,
      payload,
      sourceKeyTonic,
      sourceKeyMode,
      sourcePhraseIds,
      createdAt,
    });

    if (!phrase) {
      throw new HttpError(500, 'Failed to save music phrase.');
    }

    statements.push(
      env.DB.prepare(INSERT_MUSIC_PHRASE_SQL).bind(
        phrase.id,
        phrase.batchId,
        phrase.roomId,
        phrase.roomVersion,
        phrase.roomTitle,
        phrase.roomX,
        phrase.roomY,
        phrase.creatorUserId,
        phrase.creatorPrincipalKind,
        phrase.creatorAgentId,
        phrase.creatorDisplayName,
        phrase.instrumentId,
        phrase.ordinal,
        phrase.label,
        phrase.fingerprint,
        JSON.stringify(phrase.payload),
        phrase.sourceKeyTonic,
        phrase.sourceKeyMode,
        phrase.createdAt,
      ),
    );

    for (const sourcePhraseId of buildMusicPhraseSourceIdsForWrite(phrase.sourcePhraseIds)) {
      statements.push(
        env.DB.prepare(INSERT_MUSIC_PHRASE_SOURCE_SQL).bind(
          phrase.id,
          sourcePhraseId,
          createdAt,
        ),
      );
    }

    savedPhraseIds.push(phrase.id);
  }

  if (statements.length === 0) {
    return { items: [] };
  }

  await env.DB.batch(statements);

  const savedPhrases = await Promise.all(savedPhraseIds.map((phraseId) => loadMusicPhrase(env, phraseId)));
  return {
    items: savedPhrases.filter((phrase): phrase is MusicPhraseRecord => phrase !== null),
  };
}

export async function prepareMusicPhrasePublishStatements(
  env: Env,
  published: RoomSnapshot,
  actor: MusicPhrasePublishActor,
): Promise<D1PreparedStatement[]> {
  if (!isPatternRoomMusic(published.music)) {
    return [];
  }

  const pattern = published.music;
  const createdAt = published.publishedAt ?? published.updatedAt ?? new Date().toISOString();
  const creatorDisplayName = actor.displayName.trim() || 'Guest';
  const statements: D1PreparedStatement[] = [];
  let batchId = await loadExistingMusicPhraseBatchId(env, published.id, published.version);

  for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
    const payload = extractMusicPhrasePayloadFromPattern(pattern, instrumentId);
    if (!payload) {
      continue;
    }

    const fingerprint = getMusicPhraseFingerprint(payload);
    const latestPhrase = await loadLatestMusicPhraseSummary(env, published.id, instrumentId);
    const desiredOrdinal = latestPhrase && latestPhrase.fingerprint === fingerprint
      ? latestPhrase.ordinal
      : latestPhrase
        ? latestPhrase.ordinal + 1
        : 0;
    const desiredLabel = createMusicPhraseLabel(
      creatorDisplayName,
      published.title,
      published.coordinates,
      instrumentId,
      desiredOrdinal,
      pattern.phraseNameSuffixes[instrumentId] ?? null,
    );
    if (latestPhrase && latestPhrase.fingerprint === fingerprint) {
      statements.push(
        env.DB.prepare(UPDATE_MUSIC_PHRASE_LABEL_SQL).bind(
          published.version,
          published.title,
          published.coordinates.x,
          published.coordinates.y,
          creatorDisplayName,
          desiredLabel,
          fingerprint,
          JSON.stringify(payload),
          payload.kind === 'tonal' ? payload.keyTonic : null,
          payload.kind === 'tonal' ? payload.keyMode : null,
          published.id,
          instrumentId,
          latestPhrase.ordinal,
        ),
      );
      continue;
    }

    if (!batchId) {
      batchId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(INSERT_MUSIC_PHRASE_BATCH_SQL).bind(
          batchId,
          published.id,
          published.version,
          published.title,
          published.coordinates.x,
          published.coordinates.y,
          actor.userId,
          actor.principalKind,
          actor.agentId,
          creatorDisplayName,
          createdAt,
        ),
      );
    }

    const ordinal = desiredOrdinal;
    const sourcePhraseIds = pattern.sourcePhraseIds[instrumentId];
    const sourceKeyTonic = payload.kind === 'tonal' ? payload.keyTonic : null;
    const sourceKeyMode = payload.kind === 'tonal' ? payload.keyMode : null;
    const phraseId = crypto.randomUUID();
    const phrase = cloneMusicPhraseRecord({
      id: phraseId,
      batchId,
      roomId: published.id,
      roomVersion: published.version,
      roomTitle: published.title,
      roomX: published.coordinates.x,
      roomY: published.coordinates.y,
      creatorUserId: actor.userId,
      creatorPrincipalKind: actor.principalKind,
      creatorAgentId: actor.agentId,
      creatorDisplayName,
      instrumentId,
      ordinal,
      label: desiredLabel,
      fingerprint,
      payload,
      sourceKeyTonic,
      sourceKeyMode,
      sourcePhraseIds,
      createdAt,
    });

    if (!phrase) {
      throw new HttpError(500, 'Failed to persist published music phrase.');
    }

    statements.push(
      env.DB.prepare(INSERT_MUSIC_PHRASE_SQL).bind(
        phrase.id,
        phrase.batchId,
        phrase.roomId,
        phrase.roomVersion,
        phrase.roomTitle,
        phrase.roomX,
        phrase.roomY,
        phrase.creatorUserId,
        phrase.creatorPrincipalKind,
        phrase.creatorAgentId,
        phrase.creatorDisplayName,
        phrase.instrumentId,
        phrase.ordinal,
        phrase.label,
        phrase.fingerprint,
        JSON.stringify(phrase.payload),
        phrase.sourceKeyTonic,
        phrase.sourceKeyMode,
        phrase.createdAt,
      ),
    );

    for (const sourcePhraseId of phrase.sourcePhraseIds) {
      statements.push(
        env.DB.prepare(INSERT_MUSIC_PHRASE_SOURCE_SQL).bind(
          phrase.id,
          sourcePhraseId,
          createdAt,
        ),
      );
    }
  }

  return statements;
}

export async function listMusicPhrases(
  env: Env,
  options: {
    instrumentId: RoomPatternInstrumentId;
    cursor?: string | null;
    limit?: number;
  },
): Promise<MusicPhraseListResponse> {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 24) || 24));
  const cursor = decodeMusicPhraseCursor(options.cursor ?? null);

  const result = await env.DB.prepare(
    `
      SELECT
        p.id,
        p.batch_id,
        p.room_id,
        p.room_version,
        p.room_title,
        p.room_x,
        p.room_y,
        p.creator_user_id,
        p.creator_principal_type,
        p.creator_agent_id,
        p.creator_display_name,
        p.instrument_id,
        p.ordinal,
        p.label,
        p.fingerprint,
        p.payload_json,
        p.source_key_tonic,
        p.source_key_mode,
        p.created_at,
        GROUP_CONCAT(s.source_phrase_id) AS source_phrase_ids_csv
      FROM music_phrases p
      LEFT JOIN music_phrase_sources s
        ON s.child_phrase_id = p.id
      WHERE p.instrument_id = ?
        AND (
          ? IS NULL
          OR p.created_at < ?
          OR (p.created_at = ? AND p.id < ?)
        )
      GROUP BY p.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ?
    `,
  )
    .bind(
      options.instrumentId,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit,
    )
    .all<MusicPhraseJoinRow>();

  const items = result.results.map(materializeMusicPhraseRecord);
  const lastItem = items[items.length - 1] ?? null;
  return {
    items,
    nextCursor:
      items.length === limit && lastItem
        ? encodeMusicPhraseCursor({ createdAt: lastItem.createdAt, id: lastItem.id })
        : null,
  };
}

export async function loadMusicPhrase(
  env: Env,
  phraseId: string,
): Promise<MusicPhraseRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        p.id,
        p.batch_id,
        p.room_id,
        p.room_version,
        p.room_title,
        p.room_x,
        p.room_y,
        p.creator_user_id,
        p.creator_principal_type,
        p.creator_agent_id,
        p.creator_display_name,
        p.instrument_id,
        p.ordinal,
        p.label,
        p.fingerprint,
        p.payload_json,
        p.source_key_tonic,
        p.source_key_mode,
        p.created_at,
        GROUP_CONCAT(s.source_phrase_id) AS source_phrase_ids_csv
      FROM music_phrases p
      LEFT JOIN music_phrase_sources s
        ON s.child_phrase_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
      LIMIT 1
    `,
  )
    .bind(phraseId)
    .first<MusicPhraseJoinRow>();

  return row ? materializeMusicPhraseRecord(row) : null;
}

export async function deleteMusicPhrase(
  env: Env,
  phraseId: string,
  actorUserId: string,
): Promise<void> {
  const phrase = await loadMusicPhrase(env, phraseId);
  if (!phrase) {
    throw new HttpError(404, 'Music phrase not found.');
  }

  if (!actorUserId || phrase.creatorUserId !== actorUserId) {
    throw new HttpError(403, 'Only the phrase creator can delete this phrase.');
  }

  await env.DB.batch([
    env.DB.prepare(DELETE_MUSIC_PHRASE_SOURCES_SQL).bind(phrase.id),
    env.DB.prepare(DELETE_MUSIC_PHRASE_SOURCE_REFERENCES_SQL).bind(phrase.id),
    env.DB.prepare(DELETE_MUSIC_PHRASE_SQL).bind(phrase.id),
    env.DB.prepare(DELETE_EMPTY_MUSIC_PHRASE_BATCH_SQL).bind(phrase.batchId, phrase.batchId),
  ]);
}

export function parseMusicPhraseInstrumentQuery(value: string | null): RoomPatternInstrumentId {
  return normalizeMusicPhraseInstrumentId(value);
}
