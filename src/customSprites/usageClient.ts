import { apiRequest } from '../api/request';
import type { CustomSpriteUsageResponse } from './usage';

export async function loadCustomSpriteUsage(spriteId: string): Promise<CustomSpriteUsageResponse> {
  return apiRequest<CustomSpriteUsageResponse>(
    `/api/custom-sprites/${encodeURIComponent(spriteId)}/usage`,
  );
}
