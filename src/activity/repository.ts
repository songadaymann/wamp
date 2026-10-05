import { apiRequest } from '../api/request';
import type { ActivityPreferences, ActivityResponse } from './model';
export interface ActivityRepository {
  load(before?: number): Promise<ActivityResponse>;
  markSeen(latestId: number): Promise<void>;
  savePreferences(preferences: Pick<ActivityPreferences, 'weeklyDigest' | 'dethroneAlerts' | 'dailyFeatures'>): Promise<ActivityPreferences>;
}
export function createActivityRepository(): ActivityRepository {
  return {
    load: before => apiRequest<ActivityResponse>(`/api/me/activity${before ? `?before=${before}` : ''}`, { cache: 'no-store' }),
    markSeen: async latestId => { await apiRequest('/api/me/activity/seen', { method: 'POST', body: JSON.stringify({ latestId }) }); },
    savePreferences: preferences => apiRequest('/api/me/activity/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),
  };
}
