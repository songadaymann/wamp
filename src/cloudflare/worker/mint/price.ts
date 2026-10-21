import { loadOptionalRequestAuth } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import { loadAnonymousPublicCache } from '../core/publicCache';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadRoomMintPriceWei, requireRoomMintConfig } from './service';

/** Public quote only: no room mutation, wallet account, signer or mint authorization. */
export async function handleCollectionPrice(request: Request, env: Env, context?: WorkerExecutionContextLike): Promise<Response> {
  await loadOptionalRequestAuth(env, request);
  if (new URL(request.url).search) throw new HttpError(400, 'Collection price takes no query parameters.');
  const config = requireRoomMintConfig(env);
  return loadAnonymousPublicCache(request, context, async () => {
    let priceWei: string;
    try {
      priceWei = await loadRoomMintPriceWei(config, { retryCount: 0, timeout: 3_000, signal: request.signal });
    } catch {
      throw new HttpError(503, 'Collection price is temporarily unavailable.');
    }
    return jsonResponse(request, { priceWei, chainId: config.chainId, contractAddress: config.contractAddress,
      quotedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'public, max-age=20' } });
  });
}
