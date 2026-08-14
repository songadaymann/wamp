import { JAM_SLUG } from '../../../jam/model';
import type { Env } from '../core/types';
import { isExpandedRoomSchemaMissingError } from '../expandedRooms/schemaErrors';

export async function countJamRegistrations(env: Env): Promise<number> {
  const row = await env.JAM_DB.prepare(
    'SELECT COUNT(*) AS count FROM jam_registrations WHERE jam_slug = ?',
  )
    .bind(JAM_SLUG)
    .first<{ count: number | string | null }>();

  return Number(row?.count ?? 0);
}

export async function countLaunchStatsQuery(
  env: Env,
  query: string,
  bindings: unknown[] = [],
): Promise<number> {
  const prepared = env.DB.prepare(query);
  const row =
    bindings.length > 0
      ? await prepared.bind(...bindings).first<{ count: number | string | null }>()
      : await prepared.first<{ count: number | string | null }>();

  return Number(row?.count ?? 0);
}

export async function countExpandedRoomQuery(
  env: Env,
  query: string,
  bindings: unknown[] = [],
): Promise<number> {
  try {
    return await countLaunchStatsQuery(env, query, bindings);
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) return 0;
    throw error;
  }
}

export async function countExpandedRoomAwareQuery(
  env: Env,
  query: string,
  bindings: unknown[],
  fallbackQuery: string,
  fallbackBindings: unknown[] = bindings,
): Promise<number> {
  try {
    return await countLaunchStatsQuery(env, query, bindings);
  } catch (error) {
    if (isExpandedRoomSchemaMissingError(error)) {
      return countLaunchStatsQuery(env, fallbackQuery, fallbackBindings);
    }
    throw error;
  }
}
