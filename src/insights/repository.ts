import { ApiError, apiRequest } from '../api/request';
import type { RoomInsightsResponse, RoomInsightTarget } from './model';
export async function loadRoomInsights(target: RoomInsightTarget): Promise<RoomInsightsResponse> {
  const segment = target.contentType === 'room' ? 'rooms' : target.contentType === 'course' ? 'courses' : 'expanded-rooms';
  try { return await apiRequest<RoomInsightsResponse>(`/api/${segment}/${encodeURIComponent(target.contentId)}/stats${target.version ? `?version=${target.version}` : ''}`, { cache: 'no-store' });
  } catch (error) {
    // Server explanations pass through; network failures get a plain retry message.
    if (error instanceof ApiError && error.message) throw new Error(error.message);
    throw new Error('Play statistics could not load. Try again.');
  }
}
