import { createPublicClient, http } from 'viem';
import type { RoomMintConfig } from '../core/types';
import { HttpError } from '../core/http';

export interface MintReadTransportOptions {
  retryCount?: number;
  timeout?: number;
  signal?: AbortSignal;
}

/** Server transport remains separate from the public wallet network information. */
export function createRoomMintPublicClient(config: RoomMintConfig, transport: MintReadTransportOptions = {}) {
  const { signal, ...options } = transport;
  return createPublicClient({ transport: http(config.rpcUrl, { ...options,
    ...(signal ? { fetchFn: (input, init) => fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    }) } : {}),
  }) });
}

/** One finite network check per operation, with no shared request I/O or idle work. */
export async function createVerifiedRoomMintPublicClient(config: RoomMintConfig, transport: MintReadTransportOptions = {}) {
  const snapshot = { ...config };
  await assertRoomMintNetwork(snapshot, transport);
  return createRoomMintPublicClient(snapshot, transport);
}

export async function assertRoomMintNetwork(config: RoomMintConfig, transport: MintReadTransportOptions = {}): Promise<void> {
  const snapshot = { ...config };
  const timeout = transport.timeout && transport.timeout > 0 ? Math.min(transport.timeout, 2_000) : 2_000;
  const probe = createRoomMintPublicClient(snapshot, { retryCount: 0, timeout, signal: transport.signal });
  let actual: number;
  try {
    actual = await probe.getChainId();
  } catch {
    // Provider diagnostics can contain a private URL/key. Never forward them.
    throw new HttpError(503, 'Room minting is temporarily unavailable. Please try again later.');
  }
  if (actual !== snapshot.chainId) {
    throw new HttpError(503, 'Room minting is unavailable because its server network does not match its configuration.');
  }
}
