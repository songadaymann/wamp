import { apiRequest } from '../api/request';
import type { DailyResponse } from './model';
export interface DailyRepository { load(): Promise<DailyResponse> }
export function createDailyRepository(): DailyRepository {
  return { load: () => apiRequest('/api/daily',{cache:'no-store'}) };
}
