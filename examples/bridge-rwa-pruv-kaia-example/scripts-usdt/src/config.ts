import { ChainConfig } from './types';

// ============ Supported Chains ============

export const CHAINS: Record<string, ChainConfig> = {
  kaia: {
    name: 'Kaia Kairos Testnet',
    domainId: 1001,
    chainId: 1001,
    rpcUrl: 'https://public-en-kairos.node.kaia.io',
    warpRoute: '0x8fe41adb2890df3d591160052fb0e502e4f07f11',
    tokenAddress: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
    explorerTxUrl: 'https://kairos.kaiascan.io/tx/',
  },
  pruv: {
    name: 'Pruv Testnet',
    domainId: 7336,
    chainId: 7336,
    rpcUrl: 'https://rpc.testnet.pruv.network',
    warpRoute: '0xe0f0a2d91ca9a3db5635048f8b2be4a016bba592',
    tokenAddress: '0xc547f385c7D0A50Bb4b4889dF4d863F0abAD2885',
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
