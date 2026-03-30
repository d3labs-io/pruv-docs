import { ChainConfig } from './types';

// ============ Supported Chains ============
// RWA token: "KAIA TEST" (KAI), 6 decimals, ERC1967Proxy
//
// PRUV side: HypERC20CollateralWithFee (wraps RWA token 0x16cE242211458bd215eC7304367520F60B0D09c9)
//   - Fee token: USDC (0xeCacC484026a02022565496E088CA0581cC36373), 6 decimals
// Kaia side:  HypERC20 synthetic (warp route IS the token)

export const CHAINS: Record<string, ChainConfig> = {
  kaia: {
    name: 'Kaia Kairos Testnet',
    domainId: 1001,
    chainId: 1001,
    rpcUrl: 'https://public-en-kairos.node.kaia.io',
    warpRoute: '0x1daeeb8410741c38ed77fc0d120186bd6b6e0306',
    tokenAddress: '0x1daeeb8410741c38ed77fc0d120186bd6b6e0306',
    explorerTxUrl: 'https://kairos.kaiascan.io/tx/',
  },
  pruv: {
    name: 'Pruv Testnet',
    domainId: 7336,
    chainId: 7336,
    rpcUrl: 'https://rpc.testnet.pruv.network',
    warpRoute: '0x6a7ac9211E92cF0c4481BC606666b30B2d110592',
    tokenAddress: '0x16cE242211458bd215eC7304367520F60B0D09c9',
    explorerTxUrl: 'https://explorer.testnet.pruv.network/tx/',
  },
};

// ============ ABIs (minimal) ============

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

export const WARP_ROUTE_ABI = [
  'function transferRemote(uint32 _destination, bytes32 _recipient, uint256 _amountOrId) payable returns (bytes32 messageId)',
  'function quoteTransferRemote(uint32 _destination, bytes32 _recipient, uint256 _amount) view returns (tuple(address token, uint256 amount)[])',
  'event ReceivedTransferRemote(uint32 indexed origin, bytes32 indexed recipient, uint256 amount)',
];

// ============ Constants ============

export const RELAY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const POLL_INTERVAL_MS = 5_000;           // 5 seconds
