import type { PendingRoomWallet } from './pendingRoomWallet';

export function pending(overrides: Partial<PendingRoomWallet> = {}): PendingRoomWallet {
  return { id: 'test-operation', kind: 'mint', roomId: '0,1', coordinates: { x: 0, y: 1 },
    userId: 'builder', wallet: '0x' + '1'.repeat(40), chainId: 8453, contractAddress: '0x' + '2'.repeat(40),
    txHash: '0x' + '3'.repeat(64), tokenId: null, metadataHash: null, metadataRoomVersion: null,
    createdAt: 1_792_500_000_000, ...overrides };
}
export function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
