import { apiRequest } from '../api/request';
import type { RoomInsightsResponse, RoomInsightTarget } from './model';
export async function loadRoomInsights(target: RoomInsightTarget): Promise<RoomInsightsResponse> {
  const segment = target.contentType === 'room' ? 'rooms' : target.contentType === 'course' ? 'courses' : 'expanded-rooms';
  try { return await apiRequest<RoomInsightsResponse>(`/api/${segment}/${encodeURIComponent(target.contentId)}/stats${target.version ? `?version=${target.version}` : ''}`, { cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error) {
      let details: { error?: string } | null = null;
      try { details = JSON.parse(error.message); } catch { /* Plain network error. */ }
      if (details?.error) throw new Error(details.error);
    }
    throw new Error('Play statistics could not load. Try again.');
  }
}
