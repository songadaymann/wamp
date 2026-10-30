/** Explicit network selection for minting and standalone token previews. */
export function parseRoomChainId(value: string | null | undefined): number | null {
  const raw = value?.trim();
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getRoomMintNetwork(chainId: number) {
  switch (chainId) {
    case 8453:
      return { name: 'Base', rpcUrl: 'https://mainnet.base.org', blockExplorerUrl: 'https://basescan.org' };
    case 84532:
      return { name: 'Base Sepolia', rpcUrl: 'https://sepolia.base.org', blockExplorerUrl: 'https://sepolia.basescan.org' };
    default:
      return null;
  }
}
