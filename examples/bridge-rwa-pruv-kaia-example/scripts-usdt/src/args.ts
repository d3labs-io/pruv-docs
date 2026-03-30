import { ethers } from 'ethers';
import { CHAINS } from './config';
import { BridgeArgs } from './types';

/**
 * Parses CLI arguments and .env values into a validated BridgeArgs object.
 * CLI flags override .env values. Exits on validation failure.
 *
 * Token address is determined automatically from the source chain config.
 */
export function parseArgs(): BridgeArgs {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace('--', '');
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed[key] = value;
        i++;
      }
    }
  }

  const privateKey =
    parsed['private-key'] || process.env.PRIVATE_KEY || '';
  const tokenAmount =
    parsed['token-amount'] || process.env.TOKEN_AMOUNT || '';
  const sourceChain =
    parsed['source-chain'] || process.env.SOURCE_CHAIN || 'kaia';
  const destinationChain =
    parsed['destination-chain'] || process.env.DESTINATION_CHAIN || 'pruv';
  const recipient = parsed['recipient'] || process.env.RECIPIENT || '';

  // ── Required fields ──────────────────────────────────────

  if (!privateKey) {
    console.error(
      'Error: Private key is required. Use --private-key <key> or set PRIVATE_KEY in .env',
    );
    process.exit(1);
  }

  if (!tokenAmount) {
    console.error(
      'Error: Token amount is required. Use --token-amount <amount> or set TOKEN_AMOUNT in .env',
    );
    process.exit(1);
  }

  // ── Validation ───────────────────────────────────────────

  if (isNaN(Number(tokenAmount)) || Number(tokenAmount) <= 0) {
    console.error(
      `Error: Invalid token amount "${tokenAmount}". Must be a positive number (e.g., 0.1, 1, 1.5).`,
    );
    process.exit(1);
  }

  if (recipient && !ethers.utils.isAddress(recipient)) {
    console.error(
      `Error: Invalid recipient address "${recipient}". Must be a valid Ethereum address.`,
    );
    process.exit(1);
  }

  // ── Chain validation ─────────────────────────────────────

  const srcKey = sourceChain.toLowerCase();
  const dstKey = destinationChain.toLowerCase();

  if (!CHAINS[srcKey]) {
    console.error(
      `Error: Unknown source chain "${sourceChain}". Supported: ${Object.keys(CHAINS).join(', ')}`,
    );
    process.exit(1);
  }

  if (!CHAINS[dstKey]) {
    console.error(
      `Error: Unknown destination chain "${destinationChain}". Supported: ${Object.keys(CHAINS).join(', ')}`,
    );
    process.exit(1);
  }

  if (srcKey === dstKey) {
    console.error('Error: Source and destination chains must be different.');
    process.exit(1);
  }

  return {
    privateKey: privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`,
    tokenAmount,
    sourceChain: srcKey,
    destinationChain: dstKey,
    recipient: recipient || undefined,
  };
}
