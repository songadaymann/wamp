import type { PagesWorkerHandler } from './model';
import { handleRoomImageRequest } from './roomImageRenderer';
import { handleSharePageRequest, parseRoomImageCoordinates } from './shareRoutes';
import { handleStaticAssetRequest } from './staticAssets';

export function createPagesWorker(): PagesWorkerHandler {
  return {
    async fetch(request, env) {
      const staticAssetResponse = await handleStaticAssetRequest(request, env);
      if (staticAssetResponse) {
        return staticAssetResponse;
      }

      const url = new URL(request.url);
      const imageCoordinates = parseRoomImageCoordinates(url.pathname);
      if (imageCoordinates) {
        return handleRoomImageRequest(request, env, url, imageCoordinates);
      }

      const sharePageResponse = await handleSharePageRequest(request, env, url);
      return sharePageResponse ?? env.ASSETS.fetch(request);
    },
  };
}
