import type { PendingRoomWallet } from './pendingRoomWallet';
import { getRoomMintNetwork } from './roomNetwork';

/** Read-only, allowlisted public RPC. Storage never supplies an endpoint or wallet provider. */
export async function checkRoomWalletReceipt(
  pending: PendingRoomWallet, signal: AbortSignal, request: typeof fetch = fetch,
): Promise<'success' | 'reverted' | null> {
  const network = getRoomMintNetwork(pending.chainId);
  if (!network || !pending.txHash) return null;
  const rpc = async (method: string, params: unknown[]) => {
    const response = await request(network.rpcUrl, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error('The public wallet check is unavailable.');
    const body = await response.json() as { error?: unknown; result?: unknown };
    if (body.error) throw new Error('The public wallet check is unavailable.');
    return body.result;
  };
  try {
    if (await rpc('eth_chainId', []) !== `0x${pending.chainId.toString(16)}`) return null;
    const receipt = await rpc('eth_getTransactionReceipt', [pending.txHash]) as {
      transactionHash?: string; to?: string; from?: string; status?: string; blockNumber?: string;
    } | null;
    if (receipt?.transactionHash?.toLowerCase() !== pending.txHash.toLowerCase()
      || receipt.to?.toLowerCase() !== pending.contractAddress.toLowerCase()
      || receipt.from?.toLowerCase() !== pending.wallet.toLowerCase()
      || !/^0x[0-9a-f]+$/i.test(receipt.blockNumber ?? '')) return null;
    return receipt.status === '0x0' ? 'reverted' : receipt.status === '0x1' ? 'success' : null;
  } catch (error) {
    if (signal.aborted) throw error;
    return null; // Unavailable is unknown, never permission to request another approval.
  }
}
