import { ethers } from 'ethers';
import { ERC20_ABI } from './config';
import { TokenInfo } from './types';

// ============ Formatting Helpers ============

/** Pads an address to 32 bytes (Hyperlane recipient format). */
export function addressToBytes32(address: string): string {
  return ethers.utils.hexZeroPad(address, 32);
}

/** Prints a visual separator line to the console. */
export function printSeparator(): void {
  console.log('─'.repeat(60));
}

// ============ Token Helpers ============

/**
 * Fetches symbol and decimals for an ERC20 token.
 * Falls back to { symbol: 'TOKEN', decimals: 18 } on error.
 */
export async function getTokenInfo(
  tokenAddress: string,
  signerOrProvider: ethers.Signer | ethers.providers.Provider,
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
  requiredAmount: ethers.BigNumber,
  wallet: ethers.Wallet,
  explorerTxUrl: string,
  label: string,
): Promise<string | undefined> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const info = await getTokenInfo(tokenAddress, wallet);
  const currentAllowance = await token.allowance(wallet.address, spender);

  if (currentAllowance.gte(requiredAmount)) {
    console.log(
      `  ✅ ${label} already approved (${ethers.utils.formatUnits(currentAllowance, info.decimals)} ${info.symbol})`,
    );
    return undefined;
  }

  const formatted = ethers.utils.formatUnits(requiredAmount, info.decimals);
  console.log(
    `  Current allowance: ${ethers.utils.formatUnits(currentAllowance, info.decimals)} ${info.symbol}`,
  );
  console.log(`  Approving ${formatted} ${info.symbol} to warp route...`);

  const approveTx = await token.approve(spender, requiredAmount);
  console.log(`  Approve tx:  ${explorerTxUrl}${approveTx.hash}`);
  await approveTx.wait();
  console.log(`  ✅ ${label} approval confirmed`);
  return approveTx.hash;
}
