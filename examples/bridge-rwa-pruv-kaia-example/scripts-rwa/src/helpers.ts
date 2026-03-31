import { ethers } from 'ethers';
import { ERC20_ABI, WARP_ROUTE_ABI } from './config';
import { ChainConfig, TokenInfo } from './types';

// ============ Formatting Helpers ============

/** Pads an address to 32 bytes (Hyperlane recipient format). */
export function addressToBytes32(address: string): string {
  return ethers.zeroPadValue(address, 32);
}

/** Prints a visual separator line to the console. */
export function printSeparator(): void {
  console.log('─'.repeat(60));
}

// ============ Token Helpers ============

/**
 * Resolves the underlying token address from a warp route contract.
 * Calls `wrappedToken()` on-chain; falls back to the warp route address
 * itself (synthetic HypERC20 routes where the warp route IS the token).
 */
export async function getWrappedToken(
  chain: ChainConfig,
  signerOrProvider: ethers.Signer | ethers.Provider,
): Promise<string> {
  const contract = new ethers.Contract(chain.warpRoute, WARP_ROUTE_ABI, signerOrProvider);
  try {
    return await contract.wrappedToken();
  } catch {
    // Synthetic routes (e.g. HypERC20) don't expose wrappedToken();
    // the warp route address itself is the token.
    return chain.warpRoute;
  }
}

/**
 * Fetches symbol and decimals for an ERC20 token.
 * Falls back to { symbol: 'TOKEN', decimals: 18 } on error.
 */
export async function getTokenInfo(
  tokenAddress: string,
  signerOrProvider: ethers.Signer | ethers.Provider,
): Promise<TokenInfo> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signerOrProvider);
  try {
    const [symbol, decimals] = await Promise.all([
      contract.symbol(),
      contract.decimals(),
    ]);
    return { symbol, decimals };
  } catch {
    return { symbol: 'TOKEN', decimals: 18 };
  }
}

// ============ Approval Helper ============

/**
 * Checks current ERC20 allowance and approves if insufficient.
 * @returns The approval tx hash, or undefined if already approved.
 */
export async function ensureAllowance(
  tokenAddress: string,
  spender: string,
  requiredAmount: bigint,
  wallet: ethers.Wallet,
  explorerTxUrl: string,
  label: string,
): Promise<string | undefined> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const info = await getTokenInfo(tokenAddress, wallet);
  const currentAllowance = await token.allowance(wallet.address, spender);

  if (currentAllowance >= requiredAmount) {
    console.log(
      `  ✅ ${label} already approved (${ethers.formatUnits(currentAllowance, info.decimals)} ${info.symbol})`,
    );
    return undefined;
  }

  const formatted = ethers.formatUnits(requiredAmount, info.decimals);
  console.log(
    `  Current allowance: ${ethers.formatUnits(currentAllowance, info.decimals)} ${info.symbol}`,
  );
  console.log(`  Approving ${formatted} ${info.symbol} to warp route...`);

  const approveTx = await token.approve(spender, requiredAmount);
  console.log(`  Approve tx:  ${explorerTxUrl}${approveTx.hash}`);
  await approveTx.wait();
  console.log(`  ✅ ${label} approval confirmed`);
  return approveTx.hash;
}
