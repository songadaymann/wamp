export interface WalletGateResult {
  hasWallet: boolean;
  evm: boolean;
  solana: boolean;
  names: string[];
  forced?: boolean;
}
export function applyWalletGate(options?: { root?: HTMLElement; timeout?: number }): Promise<WalletGateResult>;
