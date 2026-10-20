import type { RoomMintChainInfo } from '../../../mint/roomOwnership';
import { HttpError } from '../core/http';
import type { RoomMintConfig } from '../core/types';
import { getRoomMintNetwork } from '../../../mint/roomNetwork';

/** Wallet network setup uses public endpoints, independently of the server transport. */
export function buildWalletMintChainInfo(
  config: Pick<RoomMintConfig, 'chainId' | 'chainName' | 'blockExplorerUrl'>,
): RoomMintChainInfo {
  const rpcUrl = getRoomMintNetwork(config.chainId)?.rpcUrl;

  if (!rpcUrl) {
    throw new HttpError(503, 'Wallet network setup is unavailable for the configured mint chain.');
  }

  return {
    chainId: config.chainId,
    name: config.chainName,
    rpcUrl,
    blockExplorerUrl: config.blockExplorerUrl,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  };
}
