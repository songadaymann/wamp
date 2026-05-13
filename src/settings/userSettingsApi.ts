import { apiRequest } from '../api/request';
import type {
  GameSettings,
  UserSettingsResponse,
  UserSettingsUpdateResponse,
} from './model';

export interface UserSettingsRepository {
  loadMySettings(): Promise<UserSettingsResponse>;
  saveMySettings(settings: GameSettings): Promise<UserSettingsUpdateResponse>;
}

class ApiUserSettingsRepository implements UserSettingsRepository {
  async loadMySettings(): Promise<UserSettingsResponse> {
    return apiRequest<UserSettingsResponse>('/api/settings/me');
  }

  async saveMySettings(settings: GameSettings): Promise<UserSettingsUpdateResponse> {
    return apiRequest<UserSettingsUpdateResponse>('/api/settings/me', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    });
  }
}

export function createUserSettingsRepository(): UserSettingsRepository {
  return new ApiUserSettingsRepository();
}
