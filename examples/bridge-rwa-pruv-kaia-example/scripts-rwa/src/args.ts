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
      } else {
        // Boolean flag with no value (e.g. --mint)
        parsed[key] = 'true';
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

  const mintRaw = parsed['mint'] || process.env.MINT || '';
  const mint = ['true', '1', 'yes'].includes(mintRaw.toLowerCase());

  const redeemRaw = parsed['redeem'] || process.env.REDEEM || '';
  const redeem = ['true', '1', 'yes'].includes(redeemRaw.toLowerCase());

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

  if (recipient && !ethers.isAddress(recipient)) {
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

  if (mint && (srcKey !== 'pruv' || dstKey !== 'kaia')) {
    console.error(
      'Error: --mint is only available for pruv → kaia direction (RWA vault lives on PRUV).',
    );
    process.exit(1);
  }

  if (redeem && (srcKey !== 'kaia' || dstKey !== 'pruv')) {
    console.error(
      'Error: --redeem is only available for kaia → pruv direction (RWA vault lives on PRUV).',
    );
    process.exit(1);
  }

  if (mint && redeem) {
    console.error('Error: --mint and --redeem cannot be used together.');
    process.exit(1);
  }

  return {
    privateKey: privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`,
    tokenAmount,
    sourceChain: srcKey,
    destinationChain: dstKey,
    recipient: recipient || undefined,
    mint,
    redeem,
  };
}
