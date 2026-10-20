import type { RoomMintChainInfo } from '../../../mint/roomOwnership';
import { HttpError } from '../core/http';
import type { RoomMintConfig } from '../core/types';

/** Wallet network setup uses public endpoints, independently of the server transport. */
export function buildWalletMintChainInfo(
  config: Pick<RoomMintConfig, 'chainId' | 'chainName' | 'blockExplorerUrl'>,
): RoomMintChainInfo {
  const rpcUrl = config.chainId === 8453
    ? 'https://mainnet.base.org'
    : config.chainId === 84532
      ? 'https://sepolia.base.org'
      : null;

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
