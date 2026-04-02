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

export interface MintFlowArgs {
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
  usdtAmount: string;
  usdtAmountRaw: string;

  // Phase 1: Bridge USDT Kaia → Pruv
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

  // Phase 2: Mint RWA on Pruv
  phase2: {
    vaultAddress: string;
    depositAsset: string;
    depositAssetSymbol: string;
    depositAmount: string;
    depositAmountRaw: string;
    sharesReceived?: string;
    sharesReceivedRaw?: string;
    rwaTokenAddress?: string;
    rwaTokenSymbol?: string;
    depositApprovalTxHash?: string;
    depositTxHash?: string;
    depositBlock?: number;
    depositStatus?: 'Success' | 'Reverted';
  };

  // Phase 3: Bridge RWA Pruv → Kaia
  phase3: {
    sourceChain: string;
    destinationChain: string;
    tokenAddress: string;
    tokenSymbol: string;
    rwaAmount: string;
    rwaAmountRaw: string;
    feeToken?: {
      address: string;
      symbol: string;
      decimals: number;
      amount: string;
      formatted: string;
    };
    approvalTxHash?: string;
    feeApprovalTxHash?: string;
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
