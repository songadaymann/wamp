import { getApiBaseUrl } from '../api/baseUrl';
import { readApiErrorMessage } from '../api/readApiErrorMessage';
import type { WeeklyRoomRushResponse } from './weeklyRoomRush';

export async function loadWeeklyRoomRush(): Promise<WeeklyRoomRushResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/room-rush/weekly`, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Weekly Room Rush could not load. Please retry.'));
  const body = await response.json() as WeeklyRoomRushResponse;
  if (!body.period?.weekKey || body.timeLimitMs !== 300000 || body.difficulty !== 'hard') {
    throw new Error('Weekly Room Rush is unavailable. Please reload after the update.');
  }
  return body;
}
