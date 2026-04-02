import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

import { CHAINS, ERC20_ABI, WARP_ROUTE_ABI } from './config';
import { Quote, FlowLog } from './types';
import { parseArgs } from './args';
import { addressToBytes32, printSeparator, getTokenInfo, ensureAllowance, getWrappedToken } from './helpers';
import { appendToOutputMd } from './flow-logger';
import { waitForRelayedMessage } from './relay-listener';

// Load .env from scripts directory (one level up from src/)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// ============ Main Bridge Function ============

async function bridge(): Promise<void> {
  const args = parseArgs();
  const srcChain = CHAINS[args.sourceChain];
  const dstChain = CHAINS[args.destinationChain];

  // Connect to source chain
  const provider = new ethers.JsonRpcProvider(srcChain.rpcUrl);
  const wallet = new ethers.Wallet(args.privateKey, provider);
  const senderAddress = wallet.address;
  const recipientAddress = args.recipient || senderAddress;

  // Resolve the underlying token address from the warp route contract
  const tokenAddress = await getWrappedToken(srcChain, wallet);

  printSeparator();
  console.log('🌉 PRUV Bridge — Transfer Remote');
  printSeparator();
  console.log(`  Source:      ${srcChain.name} (domain ${srcChain.domainId})`);
  console.log(`  Destination: ${dstChain.name} (domain ${dstChain.domainId})`);
  console.log(`  Token:       ${tokenAddress}`);
  console.log(`  Amount:      ${args.tokenAmount}`);
  printSeparator();

  console.log(`\n  Sender:      ${senderAddress}`);
  console.log(`  Recipient:   ${recipientAddress}`);

  // Fetch source token decimals to convert human-readable amount → raw
  const srcTokenInfo = await getTokenInfo(tokenAddress, wallet);
  const amountBN = ethers.parseUnits(args.tokenAmount, srcTokenInfo.decimals);
  console.log(`  Raw amount:  ${amountBN.toString()} (${srcTokenInfo.decimals} decimals)`);

  // ── Step 1: Approve token to warp route ──
  console.log('\n📝 Step 1: Approve token for warp route...');
  const warpRoute = new ethers.Contract(srcChain.warpRoute, WARP_ROUTE_ABI, wallet);
  const approvalTxHash = await ensureAllowance(
    tokenAddress,
    srcChain.warpRoute,
    amountBN,
    wallet,
    srcChain.explorerTxUrl,
    'Warp route',
  );

  // ── Step 2: Quote interchain gas ──
  console.log('\n💰 Step 2: Quote interchain gas...');
  const recipientB32 = addressToBytes32(recipientAddress);
  const quoteRaw: any[] = await warpRoute.quoteTransferRemote(
    dstChain.domainId,
    recipientB32,
    amountBN,
  );
  const quotes: Quote[] = quoteRaw.map((q: any) => ({
    token: q.token ?? q[0],
    amount: BigInt(q.amount ?? q[1]),
  }));

  let gasValue = 0n;
  for (const q of quotes) {
    if (q.token === ethers.ZeroAddress) {
      gasValue += q.amount;
      console.log(`  Native gas: ${ethers.formatEther(q.amount)} ETH`);
    }
  }

  // ── Step 3: Send transferRemote ──
  console.log('\n🚀 Step 3: Sending transferRemote...');
  const transferTx = await warpRoute.transferRemote(
    dstChain.domainId,
    recipientB32,
    amountBN,
    { value: gasValue },
  );
  console.log(`  Tx hash: ${srcChain.explorerTxUrl}${transferTx.hash}`);

  const receipt = await transferTx.wait();
  const transferStatus = receipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(`  ✅ Status: ${transferStatus} (block ${receipt!.blockNumber})`);

  // ── Build flow log ──
  const flowLog: FlowLog = {
    timestamp: new Date().toISOString(),
    sourceChain: srcChain,
    destinationChain: dstChain,
    sender: senderAddress,
    recipient: recipientAddress,
    tokenAddress,
    tokenAmount: args.tokenAmount,
    tokenAmountRaw: amountBN.toString(),
    transferToken: {
      address: tokenAddress,
      symbol: srcTokenInfo.symbol,
      decimals: srcTokenInfo.decimals,
      amount: amountBN.toString(),
      formatted: `${args.tokenAmount} ${srcTokenInfo.symbol}`,
    },
    gasQuote: {
      raw: gasValue.toString(),
      formatted: `${ethers.formatEther(gasValue)} native`,
    },
    approvalTxHash,
    transferTxHash: transferTx.hash,
    transferBlock: receipt!.blockNumber,
    transferGasUsed: receipt!.gasUsed.toString(),
    transferStatus,
  };

  // ── Step 4: Wait for relay ──
  console.log('\n⏳ Step 4: Waiting for relay on destination chain...');
  const dstTokenAddress = await getWrappedToken(dstChain, new ethers.JsonRpcProvider(dstChain.rpcUrl));
  const dstTokenInfo = await getTokenInfo(dstTokenAddress, new ethers.JsonRpcProvider(dstChain.rpcUrl));
  const relayResult = await waitForRelayedMessage(
    dstChain,
    srcChain,
    recipientAddress,
    dstTokenInfo,
  );

  flowLog.relayTxHash = relayResult.txHash;
  flowLog.relayBlock = relayResult.blockNumber;
  flowLog.relayAmount = relayResult.amount;
  flowLog.relayStatus = relayResult.status;

  // ── Step 5: Log results ──
  printSeparator();
  console.log('✅ Bridge complete');
  printSeparator();

  appendToOutputMd(flowLog);
}

// ============ Entry Point ============

bridge().catch((err) => {
  console.error('\n❌ Bridge failed:', err.message || err);
  process.exit(1);
});
