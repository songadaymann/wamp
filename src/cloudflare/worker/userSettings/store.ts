import {
  normalizeGameSettings,
  type GameSettings,
} from '../../../settings/model';
import type { Env, UserSettingsRow } from '../core/types';

export interface StoredUserSettings {
  settings: GameSettings;
  updatedAt: string;
}

export async function loadUserSettings(
  env: Env,
  userId: string,
): Promise<StoredUserSettings | null> {
  const row = await env.DB.prepare(
    `
      SELECT settings_json, updated_at
      FROM user_settings
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<UserSettingsRow>();

  if (!row) {
    return null;
  }

  return {
    settings: parseStoredSettings(row.settings_json),
    updatedAt: row.updated_at,
  };
}

export async function saveUserSettings(
  env: Env,
  userId: string,
  settings: GameSettings,
  nowIso: string,
): Promise<StoredUserSettings> {
  const normalizedSettings = normalizeGameSettings(settings);
  await env.DB.prepare(
    `
      INSERT INTO user_settings (
        user_id,
        settings_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = excluded.updated_at
    `
  )
    .bind(userId, JSON.stringify(normalizedSettings), nowIso, nowIso)
    .all();

  return {
    settings: normalizedSettings,
    updatedAt: nowIso,
  };
}

function parseStoredSettings(rawValue: string): GameSettings {
  try {
    return normalizeGameSettings(JSON.parse(rawValue) as Partial<GameSettings>);
  } catch {
    return normalizeGameSettings(null);
  }
}
