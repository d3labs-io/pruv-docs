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
  recipientAddress: string,
  tokenInfo: TokenInfo,
  humanAmount?: string,
  timeoutMs: number = RELAY_TIMEOUT_MS,
): Promise<RelayResult> {
  printSeparator();
  console.log('⏳ Waiting for relay on destination chain...');
  console.log(`   Polling ${dstChain.name} (${dstChain.warpRoute}) for ReceivedTransferRemote...`);
  console.log(`   Origin domain: ${srcChain.domainId}`);
  console.log(`   Timeout: ${timeoutMs / 1000}s\n`);

  const dstProvider = new ethers.JsonRpcProvider(dstChain.rpcUrl);
  const warpRoute = new ethers.Contract(dstChain.warpRoute, WARP_ROUTE_ABI, dstProvider);
  const recipientBytes32 = ethers.zeroPadValue(recipientAddress, 32);
  const startBlock = await dstProvider.getBlockNumber();
  const deadline = Date.now() + timeoutMs;

  let lastBlock = startBlock;

  while (Date.now() < deadline) {
    const currentBlock = await dstProvider.getBlockNumber();

    if (currentBlock > lastBlock) {
      try {
        const filter = warpRoute.filters.ReceivedTransferRemote(srcChain.domainId, recipientBytes32);
        const logs = await warpRoute.queryFilter(filter, lastBlock + 1, currentBlock);

        if (logs.length > 0) {
          const event = logs[logs.length - 1];
          const parsedArgs = (event as ethers.EventLog).args;
          const amount = parsedArgs ? parsedArgs[2] : undefined;
          // The event's raw amount is in Hyperlane's internal (scaled) representation,
          // which may differ from the token's own decimals. Prefer the known human amount.
          const formatted = humanAmount
            ?? (amount ? ethers.formatUnits(amount, tokenInfo.decimals) : 'unknown');

          console.log(`  ✅ Relay delivered!`);
          console.log(`     Block:  ${event.blockNumber}`);
          console.log(`     Tx:     ${dstChain.explorerTxUrl}${event.transactionHash}`);
          console.log(`     Amount: ${formatted} ${tokenInfo.symbol}`);
          printSeparator();

          return {
            status: 'Delivered',
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
            amount: formatted,
          };
        }
      } catch (err: any) {
        console.log(`  ⚠ getLogs error (retrying): ${err.message?.slice(0, 80)}`);
      }

      lastBlock = currentBlock;
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write(`\r  ⏳ Waiting... block ${currentBlock} | ${remaining}s remaining   `);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log(`\n  ⏰ Relay timeout after ${timeoutMs / 1000}s`);
  printSeparator();
  return { status: 'Timeout' };
}
