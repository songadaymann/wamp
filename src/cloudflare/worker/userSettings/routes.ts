import {
  normalizeGameSettings,
  type UserSettingsResponse,
  type UserSettingsUpdateRequestBody,
  type UserSettingsUpdateResponse,
} from '../../../settings/model';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadUserSettings, saveUserSettings } from './store';

export async function handleUserSettingsGet(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'load settings');
  const storedSettings = await loadUserSettings(env, auth.user.id);
  const responseBody: UserSettingsResponse = storedSettings
    ? {
        settings: storedSettings.settings,
        updatedAt: storedSettings.updatedAt,
      }
    : {
        settings: null,
        updatedAt: null,
      };

  return jsonResponse(request, responseBody);
}

export async function handleUserSettingsPut(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'save settings');
  const body = await parseJsonBody<Partial<UserSettingsUpdateRequestBody>>(request);
  if (!body.settings || typeof body.settings !== 'object') {
    throw new HttpError(400, 'settings are required.');
  }

  const savedSettings = await saveUserSettings(
    env,
    auth.user.id,
    normalizeGameSettings(body.settings),
    new Date().toISOString(),
  );
  const responseBody: UserSettingsUpdateResponse = {
    ok: true,
    settings: savedSettings.settings,
    updatedAt: savedSettings.updatedAt,
  };

  return jsonResponse(request, responseBody);
}
