// ============ Chain Configuration ============

export interface ChainConfig {
  name: string;
  domainId: number;
  chainId: number;
  rpcUrl: string;
  usdtWarpRoute: string;
  rwaWarpRoute: string;
  explorerTxUrl: string;
  vaultAddress?: string;
  whitelistAddress?: string;
}

// ============ Arguments ============

export interface RedeemFlowArgs {
  privateKey: string;
  tokenAmount: string;
  recipient?: string;
}

// ============ Token / Quote ============

export interface Quote {
  token: string; // address(0) for native token
  amount: bigint;
}

export interface TokenInfo {
  symbol: string;
  decimals: number;
}

// ============ Relay ============

export interface RelayResult {
  status: 'Delivered' | 'Timeout';
  txHash?: string;
  blockNumber?: number;
  amount?: string;
}

// ============ Flow Logging ============

export interface FlowLog {
  timestamp: string;
  sender: string;
  recipient: string;
  rwaAmount: string;
  rwaAmountRaw: string;

  // Phase 1: Bridge RWA Kaia → Pruv
  phase1: {
    sourceChain: string;
    destinationChain: string;
    tokenAddress: string;
    tokenSymbol: string;
    approvalTxHash?: string;
    gasQuote: { raw: string; formatted: string };
    transferTxHash?: string;
    transferBlock?: number;
    transferGasUsed?: string;
    transferStatus?: 'Success' | 'Reverted';
    relayTxHash?: string;
    relayBlock?: number;
    relayStatus?: 'Delivered' | 'Timeout' | 'Skipped';
  };

  // Phase 2: Redeem RWA → USDT on Pruv
  phase2: {
    vaultAddress: string;
    rwaTokenAddress: string;
    rwaTokenSymbol: string;
    sharesRedeemed: string;
    sharesRedeemedRaw: string;
    assetsReceived?: string;
    assetsReceivedRaw?: string;
    assetAddress?: string;
    assetSymbol?: string;
    redeemTxHash?: string;
    redeemBlock?: number;
    redeemStatus?: 'Success' | 'Reverted';
  };

  // Phase 3: Bridge USDT Pruv → Kaia
  phase3: {
    sourceChain: string;
    destinationChain: string;
    tokenAddress: string;
    tokenSymbol: string;
    usdtAmount: string;
    usdtAmountRaw: string;
    approvalTxHash?: string;
    gasQuote: { raw: string; formatted: string };
    transferTxHash?: string;
    transferBlock?: number;
    transferGasUsed?: string;
    transferStatus?: 'Success' | 'Reverted';
    relayTxHash?: string;
    relayBlock?: number;
    relayStatus?: 'Delivered' | 'Timeout' | 'Skipped';
  };
}
