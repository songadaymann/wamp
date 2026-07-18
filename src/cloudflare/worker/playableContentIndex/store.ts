import type { Env, WorkerExecutionContextLike } from '../core/types';

interface IndexedMemberRow {
  room_id: string;
}

interface PublishedExpandedRoomRow {
  id: string;
}

export function schedulePlayableContentIndexRefresh(
  context: WorkerExecutionContextLike | undefined,
  refresh: Promise<void>,
): void {
  const guarded = refresh.catch((error: unknown) => {
    console.error('Deferred playable-content index refresh failed.', error);
  });
  if (context) context.waitUntil(guarded);
  else void guarded;
}

export async function refreshPlayableContentIndexForRoom(
  env: Env,
  roomId: string,
): Promise<void> {
  try {
    const memberships = await env.DB.prepare(
      `
        SELECT DISTINCT expanded.id
        FROM expanded_rooms expanded
        INNER JOIN expanded_room_cells cells
          ON cells.expanded_room_id = expanded.id
         AND cells.expanded_room_version = expanded.published_version
        WHERE cells.room_id = ?
          AND expanded.published_json IS NOT NULL
          AND expanded.archived_at IS NULL
          AND (SELECT COUNT(*)
               FROM expanded_room_cells sibling
               WHERE sibling.expanded_room_id = expanded.id
                 AND sibling.expanded_room_version = expanded.published_version) > 1
      `,
    ).bind(roomId).all<PublishedExpandedRoomRow>();
    for (const membership of memberships.results) {
      await refreshPlayableContentIndexForExpandedRoom(env, membership.id);
    }
    await refreshStandalonePlayableContentIndexRow(env, roomId);
  } catch (error) {
    handleMissingPlayableContentIndex(error);
  }
}

export async function refreshPlayableContentIndexForExpandedRoom(
  env: Env,
  expandedRoomId: string,
): Promise<void> {
  try {
    const targetKey = `expanded_room:${expandedRoomId}`;
    const [oldMembers, newMembers] = await Promise.all([
      env.DB.prepare('SELECT room_id FROM playable_content_index_members WHERE target_key = ?')
        .bind(targetKey).all<IndexedMemberRow>(),
      env.DB.prepare(
        `
          SELECT cells.room_id
          FROM expanded_rooms expanded
          INNER JOIN expanded_room_cells cells
            ON cells.expanded_room_id = expanded.id
           AND cells.expanded_room_version = expanded.published_version
          WHERE expanded.id = ?
        `,
      ).bind(expandedRoomId).all<IndexedMemberRow>(),
    ]);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM playable_content_index_members WHERE target_key = ?').bind(targetKey),
      env.DB.prepare('DELETE FROM playable_content_index WHERE target_key = ?').bind(targetKey),
      buildExpandedRoomIndexInsert(env, expandedRoomId),
      env.DB.prepare(
        `
          INSERT INTO playable_content_index_members (target_key, room_id, room_version)
          SELECT ?, cells.room_id, cells.room_version
          FROM expanded_rooms expanded
          INNER JOIN expanded_room_cells cells
            ON cells.expanded_room_id = expanded.id
           AND cells.expanded_room_version = expanded.published_version
          WHERE expanded.id = ?
            AND EXISTS (SELECT 1 FROM playable_content_index WHERE target_key = ?)
        `,
      ).bind(targetKey, expandedRoomId, targetKey),
    ]);

    const affectedRoomIds = Array.from(new Set([
      ...oldMembers.results.map((row) => row.room_id),
      ...newMembers.results.map((row) => row.room_id),
    ]));
    await Promise.all(affectedRoomIds.map((roomId) => refreshStandalonePlayableContentIndexRow(env, roomId)));
  } catch (error) {
    handleMissingPlayableContentIndex(error);
  }
}

async function refreshStandalonePlayableContentIndexRow(env: Env, roomId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM playable_content_index WHERE target_key = ?').bind(`room:${roomId}`),
    env.DB.prepare(
      `
        INSERT INTO playable_content_index (
          target_key, target_type, content_id, version_key, representative_room_id,
          room_x, room_y, builder_user_id, builder_display_name, title, goal_type,
          published_at, first_published_at, cell_count, anchor_x, anchor_y, source_type,
          legacy_course_id, canonical_room_version, featured_at,
          quality_adjusted_average, quality_vote_count, consensus_difficulty,
          difficulty_vote_count, updated_at
        )
        WITH ratings AS (
          SELECT
            SUM(CASE WHEN quality_stars IS NOT NULL THEN 1 ELSE 0 END) AS quality_votes,
            SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars * trust_weight ELSE 0 END) AS quality_sum,
            SUM(CASE WHEN quality_stars IS NOT NULL THEN trust_weight ELSE 0 END) AS quality_weights,
            SUM(CASE WHEN difficulty_choice IS NOT NULL THEN 1 ELSE 0 END) AS difficulty_votes,
            SUM(CASE WHEN difficulty_choice = 'easy' THEN trust_weight ELSE 0 END) AS easy_weight,
            SUM(CASE WHEN difficulty_choice = 'medium' THEN trust_weight ELSE 0 END) AS medium_weight,
            SUM(CASE WHEN difficulty_choice = 'hard' THEN trust_weight ELSE 0 END) AS hard_weight,
            SUM(CASE WHEN difficulty_choice = 'extreme' THEN trust_weight ELSE 0 END) AS extreme_weight
          FROM room_ratings ratings
          WHERE ratings.room_id = ?
            AND ratings.version_key = CAST(json_extract((SELECT published_json FROM rooms WHERE id = ?), '$.version') AS INTEGER)
        )
        SELECT
          'room:' || rooms.id, 'room', rooms.id,
          CAST(json_extract(rooms.published_json, '$.version') AS INTEGER),
          rooms.id, rooms.x, rooms.y,
          rooms.last_published_by_user_id, rooms.last_published_by_display_name,
          COALESCE(rooms.published_title, json_extract(rooms.published_json, '$.title')),
          json_extract(rooms.published_json, '$.goal.type'),
          COALESCE(json_extract(rooms.published_json, '$.publishedAt'), versions.created_at),
          (SELECT MIN(created_at) FROM room_versions WHERE room_id = rooms.id),
          1, rooms.x, rooms.y, 'standalone_room', NULL, rooms.canonical_version,
          featured.featured_at,
          CASE WHEN ratings.quality_weights > 0
            THEN ROUND(((3.5 * 5) + ratings.quality_sum) / (5 + ratings.quality_weights), 3)
            ELSE NULL END,
          COALESCE(ratings.quality_votes, 0),
          CASE
            WHEN COALESCE(ratings.difficulty_votes, 0) = 0 THEN NULL
            WHEN ratings.extreme_weight >= ratings.hard_weight AND ratings.extreme_weight >= ratings.medium_weight AND ratings.extreme_weight >= ratings.easy_weight THEN 'extreme'
            WHEN ratings.hard_weight >= ratings.medium_weight AND ratings.hard_weight >= ratings.easy_weight THEN 'hard'
            WHEN ratings.medium_weight >= ratings.easy_weight THEN 'medium'
            ELSE 'easy' END,
          COALESCE(ratings.difficulty_votes, 0),
          COALESCE(json_extract(rooms.published_json, '$.publishedAt'), versions.created_at)
        FROM rooms
        INNER JOIN room_versions versions
          ON versions.room_id = rooms.id
         AND versions.version = CAST(json_extract(rooms.published_json, '$.version') AS INTEGER)
        LEFT JOIN featured_rooms featured ON featured.room_id = rooms.id
        CROSS JOIN ratings
        WHERE rooms.id = ?
          AND rooms.published_json IS NOT NULL
          AND json_extract(rooms.published_json, '$.goal.type') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM playable_content_index_members members
            INNER JOIN playable_content_index target ON target.target_key = members.target_key
            WHERE members.room_id = rooms.id AND target.target_type = 'expanded_room'
          )
      `,
    ).bind(roomId, roomId, roomId),
  ]);
}

function buildExpandedRoomIndexInsert(env: Env, expandedRoomId: string) {
  return env.DB.prepare(
    `
      INSERT INTO playable_content_index (
        target_key, target_type, content_id, version_key, representative_room_id,
        room_x, room_y, builder_user_id, builder_display_name, title, goal_type,
        published_at, first_published_at, cell_count, anchor_x, anchor_y, source_type,
        legacy_course_id, canonical_room_version, featured_at,
        quality_adjusted_average, quality_vote_count, consensus_difficulty,
        difficulty_vote_count, updated_at
      )
      WITH metadata AS (
        SELECT COUNT(*) AS cell_count, MAX(featured.featured_at) AS featured_at
        FROM expanded_rooms expanded
        INNER JOIN expanded_room_cells cells
          ON cells.expanded_room_id = expanded.id
         AND cells.expanded_room_version = expanded.published_version
        LEFT JOIN featured_rooms featured ON featured.room_id = cells.room_id
        WHERE expanded.id = ?
      ), ratings AS (
        SELECT
          SUM(CASE WHEN quality_stars IS NOT NULL THEN 1 ELSE 0 END) AS quality_votes,
          SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars * trust_weight ELSE 0 END) AS quality_sum,
          SUM(CASE WHEN quality_stars IS NOT NULL THEN trust_weight ELSE 0 END) AS quality_weights,
          SUM(CASE WHEN difficulty_choice IS NOT NULL THEN 1 ELSE 0 END) AS difficulty_votes,
          SUM(CASE WHEN difficulty_choice = 'easy' THEN trust_weight ELSE 0 END) AS easy_weight,
          SUM(CASE WHEN difficulty_choice = 'medium' THEN trust_weight ELSE 0 END) AS medium_weight,
          SUM(CASE WHEN difficulty_choice = 'hard' THEN trust_weight ELSE 0 END) AS hard_weight,
          SUM(CASE WHEN difficulty_choice = 'extreme' THEN trust_weight ELSE 0 END) AS extreme_weight
        FROM expanded_room_ratings ratings
        INNER JOIN expanded_rooms expanded ON expanded.id = ratings.expanded_room_id
        WHERE ratings.expanded_room_id = ? AND ratings.version_key = expanded.published_version
      )
      SELECT
        'expanded_room:' || expanded.id, 'expanded_room', expanded.id, expanded.published_version,
        expanded.anchor_room_id, expanded.anchor_x, expanded.anchor_y,
        expanded.owner_user_id, expanded.owner_display_name,
        COALESCE(expanded.published_title, json_extract(expanded.published_json, '$.title')),
        json_extract(expanded.published_json, '$.goal.type'),
        COALESCE(expanded.published_at, versions.created_at),
        (SELECT MIN(created_at) FROM expanded_room_versions WHERE expanded_room_id = expanded.id),
        metadata.cell_count, expanded.anchor_x, expanded.anchor_y, expanded.source_type,
        expanded.legacy_course_id, NULL, metadata.featured_at,
        CASE WHEN ratings.quality_weights > 0
          THEN ROUND(((3.5 * 5) + ratings.quality_sum) / (5 + ratings.quality_weights), 3)
          ELSE NULL END,
        COALESCE(ratings.quality_votes, 0),
        CASE
          WHEN COALESCE(ratings.difficulty_votes, 0) = 0 THEN NULL
          WHEN ratings.extreme_weight >= ratings.hard_weight AND ratings.extreme_weight >= ratings.medium_weight AND ratings.extreme_weight >= ratings.easy_weight THEN 'extreme'
          WHEN ratings.hard_weight >= ratings.medium_weight AND ratings.hard_weight >= ratings.easy_weight THEN 'hard'
          WHEN ratings.medium_weight >= ratings.easy_weight THEN 'medium'
          ELSE 'easy' END,
        COALESCE(ratings.difficulty_votes, 0), COALESCE(expanded.updated_at, expanded.published_at, versions.created_at)
      FROM expanded_rooms expanded
      INNER JOIN expanded_room_versions versions
        ON versions.expanded_room_id = expanded.id AND versions.version = expanded.published_version
      CROSS JOIN metadata CROSS JOIN ratings
      WHERE expanded.id = ?
        AND expanded.published_json IS NOT NULL
        AND expanded.published_version IS NOT NULL
        AND expanded.archived_at IS NULL
        AND metadata.cell_count > 1
    `,
  ).bind(expandedRoomId, expandedRoomId, expandedRoomId);
}

function handleMissingPlayableContentIndex(error: unknown): void {
  if (String(error).toLowerCase().includes('playable_content_index')) {
    console.warn('Playable-content index refresh skipped because the additive migration is not installed.');
    return;
  }
  throw error;
}
