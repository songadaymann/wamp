import type { PreparedWalletTransaction, RoomMintChainInfo } from './roomOwnership';
import { getRoomMintNetwork } from './roomNetwork';
import { hasCryptoWallet } from './walletGate';

export function formatRoomEth(wei: bigint): string {
  if (wei < 0n) throw new Error('Invalid room price.');
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${wei / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
}

export function getRoomWalletCost(transaction: PreparedWalletTransaction, chain: RoomMintChainInfo,
  kind: 'mint' | 'artwork', priceWei?: string): { value: bigint; amount: string; network: string } {
  const network = getRoomMintNetwork(chain.chainId);
  if (!network || transaction.chainId !== chain.chainId || chain.nativeCurrency.decimals !== 18
    || chain.nativeCurrency.symbol !== 'ETH' || typeof transaction.value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(transaction.value)) {
    throw new Error('The room cost or network changed. Prepare this action again.');
  }
  const value = BigInt(transaction.value);
  if (value >= 2n ** 256n || (kind === 'mint' && priceWei !== transaction.value) || (kind === 'artwork' && value !== 0n)) {
    throw new Error('The room cost changed. Prepare this action again.');
  }
  return { value, amount: formatRoomEth(value), network: network.name };
}

export function roomWalletCostMessage(kind: 'mint' | 'artwork', cost: ReturnType<typeof getRoomWalletCost>,
  wallet: string, balance: bigint | null): string {
  const account = /^0x[0-9a-f]{40}$/i.test(wallet) ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Linked wallet';
  const amount = kind === 'mint' ? `Collect & Lock for ${cost.amount} ETH on ${cost.network}.`
    : `Add artwork on ${cost.network}. No extra collection charge.`;
  const funds = balance === null ? 'Balance unavailable. Check it in your wallet.' : `${account}: ${formatRoomEth(balance)} ETH.`;
  const fees = kind === 'mint' ? 'Network fee is extra. Artwork is a separate transaction with its own fee.'
    : 'A network fee applies. Your wallet shows it before you approve.';
  const low = balance !== null && balance <= cost.value
    ? `\nAdd ETH to this wallet on ${cost.network}, then check your balance again.` : '';
  return `${amount}\n${funds}\n${fees}${low}`;
}

/** A single public read per explicit consent/recheck; no wallet bootstrap or idle polling. */
export async function readRoomWalletBalance(chainId: number, wallet: string, signal: AbortSignal): Promise<bigint | null> {
  const network = getRoomMintNetwork(chainId);
  if (signal.aborted || !hasCryptoWallet() || !network || !/^0x[0-9a-f]{40}$/i.test(wallet)) return null;
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 5_000);
  try {
    const response = await fetch(network.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet, 'latest'] }),
      signal: request.signal, cache: 'no-store' });
    if (!response.ok || signal.aborted || !hasCryptoWallet()) return null;
    const result = await response.json() as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (result.jsonrpc !== '2.0' || result.id !== 1 || result.error || typeof result.result !== 'string'
      || !/^0x[0-9a-f]{1,64}$/i.test(result.result)) return null;
    return signal.aborted || !hasCryptoWallet() ? null : BigInt(result.result);
  } catch { return null; }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); request.abort(); }
}
