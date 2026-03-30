import { ethers } from 'ethers';

// ============ Chain Configuration ============

export interface ChainConfig {
  name: string;
  domainId: number;
  chainId: number;
  rpcUrl: string;
  warpRoute: string;
  tokenAddress: string;
  explorerTxUrl: string;
}

// ============ Bridge Arguments ============

export interface BridgeArgs {
  privateKey: string;
  tokenAmount: string;
  sourceChain: string;
  destinationChain: string;
  recipient?: string;
}

// ============ Token / Quote ============

export interface Quote {
  token: string; // address(0) for native token
  amount: ethers.BigNumber;
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
  sourceChain: ChainConfig;
  destinationChain: ChainConfig;
  sender: string;
  recipient: string;
  tokenAddress: string;
  tokenAmount: string;      // human-readable (e.g., "1")
  tokenAmountRaw: string;   // raw decimals (e.g., "1000000")
  transferToken: {
    address: string;
    symbol: string;
    decimals: number;
    amount: string;
    formatted: string;
  };
  feeToken?: {
    address: string;
    symbol: string;
    decimals: number;
    amount: string;
    formatted: string;
  };
  gasQuote: { raw: string; formatted: string };
  approvalTxHash?: string;
  feeApprovalTxHash?: string;
  transferTxHash?: string;
  transferBlock?: number;
  transferGasUsed?: string;
  transferStatus?: 'Success' | 'Reverted';
  relayTxHash?: string;
  relayBlock?: number;
  relayAmount?: string;
  relayStatus?: 'Delivered' | 'Timeout' | 'Skipped';
}
