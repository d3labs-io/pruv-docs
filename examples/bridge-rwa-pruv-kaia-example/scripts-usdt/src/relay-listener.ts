import { ethers } from 'ethers';
import { WARP_ROUTE_ABI, RELAY_TIMEOUT_MS, POLL_INTERVAL_MS } from './config';
import { printSeparator } from './helpers';
import { ChainConfig, TokenInfo, RelayResult } from './types';

/**
 * Polls the destination chain for the ReceivedTransferRemote event.
 * Uses getLogs polling instead of WebSocket subscriptions for maximum
 * RPC compatibility (many testnet RPCs don't support eth_subscribe).
 */
export async function waitForRelayedMessage(
  dstChain: ChainConfig,
  srcChain: ChainConfig,
  recipientBytes32: string,
  humanAmount: string,
  srcTokenInfo: TokenInfo,
): Promise<RelayResult> {
  console.log('\n⏳ Step 5: Waiting for message delivery on destination...');
  console.log(`  Listening on: ${dstChain.name}`);
  console.log(`  Warp route:   ${dstChain.warpRoute}`);
  console.log(
    `  Timeout:      ${RELAY_TIMEOUT_MS / 60_000} minutes`,
  );

  const dstProvider = new ethers.providers.JsonRpcProvider(dstChain.rpcUrl);
  const dstWarpRoute = new ethers.Contract(
    dstChain.warpRoute,
    WARP_ROUTE_ABI,
    dstProvider,
  );

  // Build filter: ReceivedTransferRemote(origin, recipient, amount)
  const filter = dstWarpRoute.filters.ReceivedTransferRemote(
    srcChain.domainId,
    recipientBytes32,
  );

  const startBlock = await dstProvider.getBlockNumber();
  const deadline = Date.now() + RELAY_TIMEOUT_MS;

  let lastCheckedBlock = startBlock;
  let dots = 0;

  while (Date.now() < deadline) {
    const currentBlock = await dstProvider.getBlockNumber();

    if (currentBlock > lastCheckedBlock) {
      const events = await dstWarpRoute.queryFilter(
        filter,
        lastCheckedBlock + 1,
        currentBlock,
      );

      if (events.length > 0) {
        const event = events[0];

        // Display the user's original human-readable amount.
        // The event's raw amount is in Hyperlane's internal (scaled) representation,
        // which may differ from both source and destination token decimals.
        const displayAmount = `${humanAmount} ${srcTokenInfo.symbol}`;

        printSeparator();
        console.log('\n✅ Message delivered! Tokens received on destination.');
        console.log(`  Block:       ${event.blockNumber}`);
        console.log(`  Tx hash:     ${event.transactionHash}`);
        console.log(`  Explorer:    ${dstChain.explorerTxUrl}${event.transactionHash}`);
        console.log(
          `  Amount:      ${displayAmount}`,
        );
        printSeparator();
        return {
          status: 'Delivered',
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          amount: displayAmount,
        };
      }

      lastCheckedBlock = currentBlock;
    }

    // Show progress dots
    dots++;
    const elapsed = Math.floor((Date.now() - (deadline - RELAY_TIMEOUT_MS)) / 1000);
    process.stdout.write(`\r  Polling... ${elapsed}s elapsed ${'·'.repeat(dots % 4 + 1)}    `);

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Timeout
  printSeparator();
  console.log('\n⚠ Timed out waiting for message delivery.');
  console.log(
    '  The relayer may still deliver the message later.',
  );
  console.log(
    '  Check the destination explorer manually:',
  );
  console.log(`  ${dstChain.explorerTxUrl}`);
  printSeparator();
  return { status: 'Timeout' };
}
