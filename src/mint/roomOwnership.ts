import type { RoomCoordinates } from '../persistence/roomModel';
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';

export const DEFAULT_ROOM_MINT_CHAIN_ID = 84532;
export const DEFAULT_ROOM_MINT_CHAIN_NAME = 'Base Sepolia';
export const DEFAULT_ROOM_MINT_BLOCK_EXPLORER_URL = 'https://sepolia.basescan.org';
export const ROOM_MINT_AUTHORIZATION_TYPE =
  'RoomMintAuthorization(uint256 chainId,address verifyingContract,int32 x,int32 y,address claimer,uint256 deadline)';
export const ROOM_MINT_AUTHORIZATION_TYPEHASH = keccak256(
  stringToHex(ROOM_MINT_AUTHORIZATION_TYPE)
);

export const ROOM_OWNERSHIP_TOKEN_ABI = [
  {
    type: 'error',
    name: 'ERC721NonexistentToken',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mintPriceWei',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mintAuthority',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'roomKeyForCoordinates',
    stateMutability: 'pure',
    inputs: [
      { name: 'x', type: 'int32' },
      { name: 'y', type: 'int32' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'tokenIdForRoomCoordinates',
    stateMutability: 'view',
    inputs: [
      { name: 'x', type: 'int32' },
      { name: 'y', type: 'int32' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'mintRoom',
    stateMutability: 'payable',
    inputs: [
      { name: 'x', type: 'int32' },
      { name: 'y', type: 'int32' },
      { name: 'claimer', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mintAuthorizationHash',
    stateMutability: 'view',
    inputs: [
      { name: 'x', type: 'int32' },
      { name: 'y', type: 'int32' },
      { name: 'claimer', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'setTokenURI',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'nextTokenURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setRoomTokenURI',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'x', type: 'int32' },
      { name: 'y', type: 'int32' },
      { name: 'nextTokenURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setMintPriceWei',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nextMintPriceWei', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'event',
    name: 'RoomMinted',
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'roomKey', type: 'bytes32' },
      { indexed: false, name: 'x', type: 'int32' },
      { indexed: false, name: 'y', type: 'int32' },
      { indexed: true, name: 'minter', type: 'address' },
    ],
    anonymous: false,
  },
] as const;

export interface RoomMintChainInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  blockExplorerUrl: string | null;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface PreparedWalletTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export interface RoomMintPrepareResponse {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  linkedWalletAddress: string;
  contractAddress: string;
  priceWei: string;
  chain: RoomMintChainInfo;
  transaction: PreparedWalletTransaction;
}

export interface RoomMintConfirmRequestBody {
  txHash: string;
}

export function buildRoomMintAuthorizationHash(
  chainId: number,
  contractAddress: `0x${string}`,
  coordinates: RoomCoordinates,
  claimer: `0x${string}`,
  deadline: bigint
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'int32' },
        { type: 'int32' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        ROOM_MINT_AUTHORIZATION_TYPEHASH,
        BigInt(chainId),
        contractAddress,
        coordinates.x,
        coordinates.y,
        claimer,
        deadline,
      ]
    )
  );
}

export function buildExplorerTxUrl(
  chain: Pick<RoomMintChainInfo, 'blockExplorerUrl'>,
  txHash: string
): string | null {
  const base = chain.blockExplorerUrl?.trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }

  return `${base}/tx/${txHash}`;
}

export function formatWalletAddress(address: string | null): string {
  if (!address) {
    return 'Unknown wallet';
  }

  if (address.length < 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
