import type { RoomCoordinates } from '../persistence/roomModel';

export const PENDING_ROOM_WALLET_KEY = 'wamp:pending-room-wallet:v1';
const MAX_OPERATIONS = 16;
const MAX_BYTES = 32_768;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;

/** Recovery hints only. Neither browser storage nor a hash grants room permissions. */
export interface PendingRoomWallet {
  id: string;
  kind: 'mint' | 'artwork';
  roomId: string;
  coordinates: RoomCoordinates;
  userId: string;
  wallet: string;
  chainId: number;
  contractAddress: string;
  txHash: string | null;
  tokenId: string | null;
  metadataHash: string | null;
  metadataRoomVersion: number | null;
  createdAt: number;
}

export type PendingWalletStorage = Pick<Storage, 'getItem' | 'setItem'>;

function valid(value: unknown): value is PendingRoomWallet {
  if (!value || typeof value !== 'object') return false;
  const p = value as PendingRoomWallet, c = p.coordinates;
  const int32 = (n: number) => Number.isInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647;
  return typeof p.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(p.id)
    && (p.kind === 'mint' || p.kind === 'artwork')
    && !!c && int32(c.x) && int32(c.y) && p.roomId === `${c.x},${c.y}`
    && typeof p.userId === 'string' && p.userId.length > 0 && p.userId.length <= 200
    && ADDRESS.test(p.wallet) && ADDRESS.test(p.contractAddress)
    && (p.chainId === 8453 || p.chainId === 84532)
    && (p.txHash === null || typeof p.txHash === 'string' && HASH.test(p.txHash))
    && Number.isSafeInteger(p.createdAt) && p.createdAt > 0
    && (p.kind === 'mint'
      ? p.tokenId === null && p.metadataHash === null && p.metadataRoomVersion === null
      : typeof p.tokenId === 'string' && /^[1-9][0-9]{0,77}$/.test(p.tokenId)
        && typeof p.metadataHash === 'string' && /^[0-9a-f]{64}$/i.test(p.metadataHash)
        && Number.isSafeInteger(p.metadataRoomVersion) && p.metadataRoomVersion! > 0);
}

function copy(p: PendingRoomWallet): PendingRoomWallet {
  return { ...p, coordinates: { ...p.coordinates }, wallet: p.wallet.toLowerCase(),
    contractAddress: p.contractAddress.toLowerCase(), txHash: p.txHash?.toLowerCase() ?? null,
    metadataHash: p.metadataHash?.toLowerCase() ?? null };
}

export class PendingRoomWalletStore {
  private fallback: PendingRoomWallet[] | null = null;
  constructor(private readonly storage: PendingWalletStorage | null) {}

  list(): PendingRoomWallet[] {
    if (this.fallback) return this.fallback.map(copy);
    try {
      const raw = this.storage?.getItem(PENDING_ROOM_WALLET_KEY);
      if (!raw || raw.length > MAX_BYTES) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > MAX_OPERATIONS || !parsed.every(valid)) return [];
      if (new Set(parsed.map(p => p.id)).size !== parsed.length) return [];
      return parsed.map(copy);
    } catch { return []; }
  }

  /** Refuse new approvals when full, rather than evict a still-unknown transaction. */
  put(pending: PendingRoomWallet): { durable: boolean } {
    if (!valid(pending)) throw new Error('Invalid room wallet recovery data.');
    const entries = this.list(), index = entries.findIndex(p => p.id === pending.id);
    if (index < 0 && entries.length >= MAX_OPERATIONS) throw new Error('Check your pending room approvals before starting another.');
    if (index >= 0) entries[index] = copy(pending); else entries.push(copy(pending));
    return { durable: this.write(entries) };
  }

  remove(id: string, expectedHash: string | null): void {
    const hash = expectedHash?.toLowerCase() ?? null;
    this.write(this.list().filter(p => p.id !== id || p.txHash !== hash));
  }

  private write(entries: PendingRoomWallet[]): boolean {
    this.fallback = entries.map(copy);
    try {
      if (!this.storage) return false;
      this.storage.setItem(PENDING_ROOM_WALLET_KEY, JSON.stringify(entries));
      this.fallback = null;
      return true;
    } catch { return false; }
  }
}

let defaultStorage: PendingWalletStorage | null | undefined;
let defaultStore: PendingRoomWalletStore | undefined;
/** Lazy: importing the editor must not touch storage or load a wallet SDK. */
export function getPendingRoomWalletStore(): PendingRoomWalletStore {
  let storage: Storage | null;
  try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
  if (!defaultStore || storage !== defaultStorage) {
    defaultStorage = storage;
    defaultStore = new PendingRoomWalletStore(storage);
  }
  return defaultStore;
}
