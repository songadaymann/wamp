import { requireAdminRequest } from '../auth/request';
import { jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { isExpandedRoomSchemaMissingError } from './schemaErrors';

type MigrationReportSeverity = 'high' | 'medium' | 'low';

interface MigrationReportIssue {
  severity: MigrationReportSeverity;
  code: string;
  count: number;
  description: string;
}

export async function handleAdminExpandedRoomsMigrationReport(
  request: Request,
  env: Env,
): Promise<Response> {
  requireAdminRequest(env, request, 'read expanded rooms migration report');
  return jsonResponse(request, await buildExpandedRoomsMigrationReport(env), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

async function buildExpandedRoomsMigrationReport(env: Env): Promise<Record<string, unknown>> {
  const generatedAt = new Date().toISOString();
  const issues: MigrationReportIssue[] = [];
  const legacyCourses = {
    published: await countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM courses
        WHERE published_json IS NOT NULL
          AND published_version IS NOT NULL
      `,
    ),
    versions: await countQuery(env, 'SELECT COUNT(*) AS count FROM course_versions'),
    roomRefs: await countQuery(env, 'SELECT COUNT(*) AS count FROM course_room_refs'),
    runs: await countQuery(env, 'SELECT COUNT(*) AS count FROM course_runs'),
    ratings: await countQuery(env, 'SELECT COUNT(*) AS count FROM course_ratings'),
    trophies: await countQuery(
      env,
      "SELECT COUNT(*) AS count FROM content_trophies WHERE content_type = 'course'",
    ),
  };

  const schemaAvailable = await isExpandedRoomsSchemaAvailable(env);
  if (!schemaAvailable) {
    issues.push({
      severity: 'high',
      code: 'expanded_rooms_schema_missing',
      count: 1,
      description: 'Expanded Rooms tables are not available in this D1 database yet.',
    });
    return {
      generatedAt,
      schemaAvailable,
      legacyCourses,
      expandedRooms: null,
      copyParity: null,
      protectedCells: null,
      relatedContent: null,
      issues,
    };
  }

  const expandedRooms = {
    total: await countExpandedQuery(env, 'SELECT COUNT(*) AS count FROM expanded_rooms'),
    published: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM expanded_rooms
        WHERE published_json IS NOT NULL
          AND published_version IS NOT NULL
          AND archived_at IS NULL
      `,
    ),
    legacyCourseBacked: await countExpandedQuery(
      env,
      "SELECT COUNT(*) AS count FROM expanded_rooms WHERE source_type = 'legacy_course'",
    ),
    native: await countExpandedQuery(
      env,
      "SELECT COUNT(*) AS count FROM expanded_rooms WHERE source_type = 'native_expanded_room'",
    ),
    standalone: await countExpandedQuery(
      env,
      "SELECT COUNT(*) AS count FROM expanded_rooms WHERE source_type = 'standalone_room'",
    ),
    archived: await countExpandedQuery(
      env,
      'SELECT COUNT(*) AS count FROM expanded_rooms WHERE archived_at IS NOT NULL',
    ),
    versions: await countExpandedQuery(env, 'SELECT COUNT(*) AS count FROM expanded_room_versions'),
    cells: await countExpandedQuery(env, 'SELECT COUNT(*) AS count FROM expanded_room_cells'),
    runs: await countExpandedQuery(env, 'SELECT COUNT(*) AS count FROM expanded_room_runs'),
    ratings: await countExpandedQuery(env, 'SELECT COUNT(*) AS count FROM expanded_room_ratings'),
    trophies: await countExpandedQuery(
      env,
      "SELECT COUNT(*) AS count FROM content_trophies WHERE content_type = 'expanded_room'",
    ),
  };

  const copyParity = {
    missingExpandedRoomForPublishedCourses: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM courses c
        WHERE c.published_json IS NOT NULL
          AND c.published_version IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM expanded_rooms expanded
            WHERE expanded.id = 'course:' || c.id
               OR expanded.legacy_course_id = c.id
          )
      `,
    ),
    missingVersionCopies: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_versions v
        JOIN courses c ON c.id = v.course_id
        WHERE c.published_json IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM expanded_room_versions expanded
            WHERE expanded.expanded_room_id = 'course:' || v.course_id
              AND expanded.version = v.version
          )
      `,
    ),
    missingCellCopies: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_room_refs refs
        JOIN courses c ON c.id = refs.course_id
        WHERE c.published_json IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM expanded_room_cells cell
            WHERE cell.expanded_room_id = 'course:' || refs.course_id
              AND cell.expanded_room_version = refs.course_version
              AND cell.room_id = refs.room_id
          )
      `,
    ),
    missingRunMirrors: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_runs run
        WHERE EXISTS (
            SELECT 1
            FROM expanded_room_versions version
            WHERE version.expanded_room_id = 'course:' || run.course_id
              AND version.version = run.course_version
          )
          AND NOT EXISTS (
            SELECT 1
            FROM expanded_room_runs expanded
            WHERE expanded.legacy_course_attempt_id = run.attempt_id
               OR expanded.attempt_id = run.attempt_id
          )
      `,
    ),
    missingRatingMirrors: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_ratings rating
        WHERE EXISTS (
            SELECT 1
            FROM expanded_room_versions version
            WHERE version.expanded_room_id = 'course:' || rating.course_id
              AND version.version = rating.version_key
          )
          AND NOT EXISTS (
            SELECT 1
            FROM expanded_room_ratings expanded
            WHERE expanded.expanded_room_id = 'course:' || rating.course_id
              AND expanded.version_key = rating.version_key
              AND expanded.user_id = rating.user_id
          )
      `,
    ),
    missingTrophyMirrors: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM content_trophies trophy
        WHERE trophy.content_type = 'course'
          AND EXISTS (
            SELECT 1
            FROM expanded_room_versions version
            WHERE version.expanded_room_id = 'course:' || trophy.content_id
              AND version.version = trophy.version_key
          )
          AND NOT EXISTS (
            SELECT 1
            FROM content_trophies expanded
            WHERE expanded.content_type = 'expanded_room'
              AND expanded.content_id = 'course:' || trophy.content_id
              AND expanded.version_key = trophy.version_key
              AND expanded.trophy_type = trophy.trophy_type
          )
      `,
    ),
  };

  const protectedCells = {
    mintedRooms: await countQuery(env, 'SELECT COUNT(*) AS count FROM rooms WHERE minted_token_id IS NOT NULL'),
    protectedExpandedRoomCells: await countExpandedQuery(
      env,
      'SELECT COUNT(*) AS count FROM expanded_room_cells WHERE protected_minted = 1',
    ),
    missingProtectedMintedCells: await countExpandedQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM expanded_room_cells cell
        JOIN rooms room ON room.id = cell.room_id
        WHERE room.minted_token_id IS NOT NULL
          AND cell.protected_minted = 0
      `,
    ),
  };

  const relatedContent = {
    playlistItemsOnExpandedRoomCells: await countExpandedQuery(
      env,
      `
        SELECT COUNT(DISTINCT item.id) AS count
        FROM room_playlist_items item
        JOIN expanded_room_cells cell
          ON cell.room_id = item.room_id
         AND cell.room_version = item.room_version
      `,
    ),
    commentsOnExpandedRoomCells: await countExpandedQuery(
      env,
      `
        SELECT COUNT(DISTINCT comment.id) AS count
        FROM room_comments comment
        JOIN expanded_room_cells cell
          ON cell.room_id = comment.room_id
         AND cell.room_version = comment.room_version
      `,
    ),
  };

  addCountIssue(
    issues,
    'high',
    'missing_expanded_room_for_published_course',
    copyParity.missingExpandedRoomForPublishedCourses,
    'Published legacy courses without a corresponding Expanded Room row.',
  );
  addCountIssue(
    issues,
    'high',
    'missing_expanded_room_version_copy',
    copyParity.missingVersionCopies,
    'Legacy course versions that have not been copied into expanded_room_versions.',
  );
  addCountIssue(
    issues,
    'high',
    'missing_expanded_room_cell_copy',
    copyParity.missingCellCopies,
    'Legacy course room refs that have not been copied into expanded_room_cells.',
  );
  addCountIssue(
    issues,
    'medium',
    'missing_expanded_room_run_mirror',
    copyParity.missingRunMirrors,
    'Legacy course run rows that do not have an expanded_room_runs mirror.',
  );
  addCountIssue(
    issues,
    'medium',
    'missing_expanded_room_rating_mirror',
    copyParity.missingRatingMirrors,
    'Legacy course rating rows that do not have an expanded_room_ratings mirror.',
  );
  addCountIssue(
    issues,
    'medium',
    'missing_expanded_room_trophy_mirror',
    copyParity.missingTrophyMirrors,
    'Legacy course trophies that do not have expanded_room content trophy mirrors.',
  );
  addCountIssue(
    issues,
    'high',
    'missing_minted_cell_protection',
    protectedCells.missingProtectedMintedCells,
    'Expanded Room cells that reference minted rooms but are not marked protected.',
  );

  return {
    generatedAt,
    schemaAvailable,
    legacyCourses,
    expandedRooms,
    copyParity,
    protectedCells,
    relatedContent,
    issues,
  };
}

async function isExpandedRoomsSchemaAvailable(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 FROM expanded_rooms LIMIT 1').first();
    return true;
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return false;
    }
    throw error;
  }
}

async function countExpandedQuery(env: Env, query: string, bindings: unknown[] = []): Promise<number> {
  try {
    return await countQuery(env, query, bindings);
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return 0;
    }
    throw error;
  }
}

async function countQuery(env: Env, query: string, bindings: unknown[] = []): Promise<number> {
  const prepared = env.DB.prepare(query);
  const row =
    bindings.length > 0
      ? await prepared.bind(...bindings).first<{ count: number | string | null }>()
      : await prepared.first<{ count: number | string | null }>();
  return Math.max(0, Number(row?.count ?? 0));
}

function addCountIssue(
  issues: MigrationReportIssue[],
  severity: MigrationReportSeverity,
  code: string,
  count: number,
  description: string,
): void {
  if (count <= 0) {
    return;
  }
  issues.push({ severity, code, count, description });
}
