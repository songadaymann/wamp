import type { PagesWorkerHandler } from './model';
import { handleStaticAssetRequest } from './staticAssets';

export function createPagesWorker(legacyWorker: PagesWorkerHandler): PagesWorkerHandler {
  return {
    async fetch(request, env, context) {
      const staticAssetResponse = await handleStaticAssetRequest(request, env);
      if (staticAssetResponse) {
        return staticAssetResponse;
      }

      return legacyWorker.fetch(request, env, context);
    },
  };
}
