import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

import { CHAINS, ERC20_ABI, WARP_ROUTE_ABI } from './config';
import { Quote, FlowLog } from './types';
import { parseArgs } from './args';
import { addressToBytes32, printSeparator, getTokenInfo, ensureAllowance } from './helpers';
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
  const tokenAddress = srcChain.tokenAddress;

  printSeparator();
  console.log('🌉 PRUV Bridge — RWA Token Transfer Remote');
  printSeparator();
  console.log(`  Source:      ${srcChain.name} (domain ${srcChain.domainId})`);
  console.log(`  Destination: ${dstChain.name} (domain ${dstChain.domainId})`);
  console.log(`  Token:       ${tokenAddress}`);
  console.log(`  Amount:      ${args.tokenAmount}`);
  printSeparator();

  // Connect to source chain
  const provider = new ethers.providers.JsonRpcProvider(srcChain.rpcUrl);
  const wallet = new ethers.Wallet(args.privateKey, provider);
  const senderAddress = wallet.address;
  const recipientAddress = args.recipient || senderAddress;

  console.log(`\n  Sender:      ${senderAddress}`);
  console.log(`  Recipient:   ${recipientAddress}`);

  // Fetch source token decimals to convert human-readable amount → raw
  const srcTokenInfo = await getTokenInfo(tokenAddress, wallet);
  const amountBN = ethers.utils.parseUnits(args.tokenAmount, srcTokenInfo.decimals);
  console.log(`  Raw amount:  ${amountBN.toString()} (${srcTokenInfo.decimals} decimals)`);

  // Setup warp route contract
  const warpRoute = new ethers.Contract(
    srcChain.warpRoute,
    WARP_ROUTE_ABI,
    wallet,
  );

  // ── Step 1: Quote transfer remote ──────────────────────────
  console.log('\n📊 Step 1: Quoting transfer...');
  const recipientBytes32 = addressToBytes32(recipientAddress);

  let quotes: Quote[];
  try {
    quotes = await warpRoute.quoteTransferRemote(
      dstChain.domainId,
      recipientBytes32,
      amountBN,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Failed to quote transfer: ${msg}`);
    process.exit(1);
  }

  // Parse quotes:
  //   quotes[0] = { token: address(0), amount: gasPayment }           (native, always present)
  //   quotes[1] = { token: transferTokenAddr, amount: ... }           (transfer token, only on collateral routes)
  //   quotes[2] = { token: feeTokenAddr, amount: fee }                (fee token, only on fee-enabled routes)
  // Synthetic routes (e.g. Kaia HypERC20) may return only quotes[0].
  const gasPayment = quotes[0].amount;
  const transferTokenAddr = quotes.length >= 2 ? quotes[1].token : tokenAddress;
  const transferTokenAmount = quotes.length >= 2 ? quotes[1].amount : amountBN;

  const hasFee = quotes.length >= 3 && quotes[2].amount.gt(0);
  const feeTokenAddr = hasFee ? quotes[2].token : undefined;
  const feeAmount = hasFee ? quotes[2].amount : ethers.BigNumber.from(0);

  // Use source token info already fetched
  const transferInfo = srcTokenInfo;

  console.log(
    `  Gas quote:       ${ethers.utils.formatEther(gasPayment)} native token`,
  );
  console.log(
    `  Transfer token:  ${transferTokenAddr} (${transferInfo.symbol})`,
  );
  console.log(
    `  Transfer amount: ${ethers.utils.formatUnits(transferTokenAmount, transferInfo.decimals)} ${transferInfo.symbol}`,
  );

  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    console.log(
      `  Fee token:       ${feeTokenAddr} (${feeInfo.symbol})`,
    );
    console.log(
      `  Fee amount:      ${ethers.utils.formatUnits(feeAmount, feeInfo.decimals)} ${feeInfo.symbol}`,
    );
  } else {
    console.log('  Fee:             None');
  }

  // ── Pre-flight checks ──────────────────────────────────────
  console.log('\n🔍 Pre-flight checks...');

  const nativeBalance = await provider.getBalance(senderAddress);
  console.log(
    `  Native balance:  ${ethers.utils.formatEther(nativeBalance)}`,
  );
  if (nativeBalance.lt(gasPayment)) {
    console.error(
      `\n❌ Insufficient native balance for gas payment. Have ${ethers.utils.formatEther(nativeBalance)}, need ${ethers.utils.formatEther(gasPayment)}`,
    );
    process.exit(1);
  }

  const transferToken = new ethers.Contract(
    transferTokenAddr,
    ERC20_ABI,
    wallet,
  );
  const transferBalance = await transferToken.balanceOf(senderAddress);
  console.log(
    `  ${transferInfo.symbol} balance: ${ethers.utils.formatUnits(transferBalance, transferInfo.decimals)}`,
  );
  if (transferBalance.lt(transferTokenAmount)) {
    console.error(
      `\n❌ Insufficient ${transferInfo.symbol} balance. Have ${ethers.utils.formatUnits(transferBalance, transferInfo.decimals)}, need ${ethers.utils.formatUnits(transferTokenAmount, transferInfo.decimals)}`,
    );
    process.exit(1);
  }

  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    const feeToken = new ethers.Contract(feeTokenAddr, ERC20_ABI, wallet);
    const feeBalance = await feeToken.balanceOf(senderAddress);
    console.log(
      `  ${feeInfo.symbol} balance: ${ethers.utils.formatUnits(feeBalance, feeInfo.decimals)} (fee token)`,
    );
    if (feeBalance.lt(feeAmount)) {
      console.error(
        `\n❌ Insufficient ${feeInfo.symbol} balance for fee. Have ${ethers.utils.formatUnits(feeBalance, feeInfo.decimals)}, need ${ethers.utils.formatUnits(feeAmount, feeInfo.decimals)}`,
      );
      process.exit(1);
    }
  }

  console.log('  ✅ All checks passed');

  printSeparator();

  // ── Initialize flow log ───────────────────────────────────
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
      address: transferTokenAddr,
      symbol: transferInfo.symbol,
      decimals: transferInfo.decimals,
      amount: transferTokenAmount.toString(),
      formatted: ethers.utils.formatUnits(transferTokenAmount, transferInfo.decimals),
    },
    gasQuote: {
      raw: gasPayment.toString(),
      formatted: ethers.utils.formatEther(gasPayment),
    },
  };

  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    flowLog.feeToken = {
      address: feeTokenAddr,
      symbol: feeInfo.symbol,
      decimals: feeInfo.decimals,
      amount: feeAmount.toString(),
      formatted: ethers.utils.formatUnits(feeAmount, feeInfo.decimals),
    };
  }

  // ── Step 2: Approve transfer token ─────────────────────────
  console.log('\n📝 Step 2: Approving transfer token...');
  flowLog.approvalTxHash = await ensureAllowance(
    transferTokenAddr,
    srcChain.warpRoute,
    transferTokenAmount,
    wallet,
    srcChain.explorerTxUrl,
    transferInfo.symbol,
  );

  // ── Step 3: Approve fee token (if applicable) ──────────────
  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    console.log(`\n📝 Step 3: Approving fee token (${feeInfo.symbol})...`);
    flowLog.feeApprovalTxHash = await ensureAllowance(
      feeTokenAddr,
      srcChain.warpRoute,
      feeAmount,
      wallet,
      srcChain.explorerTxUrl,
      `${feeInfo.symbol} (fee)`,
    );
  } else {
    console.log('\n📝 Step 3: No fee token approval needed');
  }

  // ── Step 4: Call transferRemote ────────────────────────────
  console.log('\n🚀 Step 4: Calling transferRemote...');
  console.log(`  destination: ${dstChain.domainId}`);
  console.log(`  recipient:   ${recipientBytes32}`);
  console.log(`  amount:      ${amountBN.toString()} (${args.tokenAmount} ${transferInfo.symbol})`);
  console.log(`  value:       ${ethers.utils.formatEther(gasPayment)}`);

  const tx = await warpRoute.transferRemote(
    dstChain.domainId,
    recipientBytes32,
    amountBN,
    { value: gasPayment },
  );

  console.log(`\n  📤 Tx hash:  ${tx.hash}`);
  console.log(`  Explorer:    ${srcChain.explorerTxUrl}${tx.hash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await tx.wait();
  flowLog.transferTxHash = tx.hash;
  flowLog.transferBlock = receipt.blockNumber;
  flowLog.transferGasUsed = receipt.gasUsed.toString();

  if (receipt.status !== 1) {
    flowLog.transferStatus = 'Reverted';
    flowLog.relayStatus = 'Skipped';
    appendToOutputMd(flowLog);

    printSeparator();
    console.error('\n❌ Transaction reverted on-chain!');
    console.error(`  Block:       ${receipt.blockNumber}`);
    console.error(`  Gas used:    ${receipt.gasUsed.toString()}`);
    console.error(`  Explorer:    ${srcChain.explorerTxUrl}${tx.hash}`);
    printSeparator();
    process.exit(1);
  }

  flowLog.transferStatus = 'Success';

  printSeparator();
  console.log('\n✅ Transfer submitted successfully!');
  console.log(`  Block:       ${receipt.blockNumber}`);
  console.log(`  Gas used:    ${receipt.gasUsed.toString()}`);
  console.log(`  Status:      Success`);
  printSeparator();

  console.log('\n📋 Summary:');
  console.log(
    `  Bridged ${ethers.utils.formatUnits(amountBN, transferInfo.decimals)} ${transferInfo.symbol} from ${srcChain.name} → ${dstChain.name}`,
  );
  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    console.log(
      `  Fee paid: ${ethers.utils.formatUnits(feeAmount, feeInfo.decimals)} ${feeInfo.symbol}`,
    );
  }
  console.log(`  Recipient: ${recipientAddress}`);
  console.log(
    '\n  ⏳ The relayer will deliver the message to the destination chain.',
  );

  // ── Step 5: Wait for delivery on destination ───────────────
  const relayResult = await waitForRelayedMessage(
    dstChain,
    srcChain,
    recipientBytes32,
    args.tokenAmount,
    transferInfo,
  );

  flowLog.relayStatus = relayResult.status;
  flowLog.relayTxHash = relayResult.txHash;
  flowLog.relayBlock = relayResult.blockNumber;
  flowLog.relayAmount = relayResult.amount;

  // ── Write flow log to output.md ────────────────────────────
  appendToOutputMd(flowLog);
}

// ============ Run ============

bridge().catch((error) => {
  console.error('\n❌ Bridge failed:', error.message || error);
  process.exit(1);
});
