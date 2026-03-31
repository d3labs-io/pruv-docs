import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

import { CHAINS, ERC20_ABI, WARP_ROUTE_ABI, VAULT_ABI, WHITELIST_ABI, FEE_ABI } from './config';
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
  console.log('🌉 PRUV Bridge — RWA Token Transfer Remote');
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

  // ── Step 0 (optional): Mint RWA tokens via vault deposit ──
  if (args.mint) {
    console.log('\n🏦 Step 0: Minting RWA tokens via vault deposit...');

    const vaultAddr = srcChain.vaultAddress!;
    const whitelistAddr = srcChain.whitelistAddress!;

    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, wallet);
    const whitelist = new ethers.Contract(whitelistAddr, WHITELIST_ABI, wallet);

    // a. Check whitelist
    const wlBalance = await whitelist.balanceOf(senderAddress, 1);
    if (wlBalance === 0n) {
      console.error('\n❌ User is not whitelisted. Cannot mint RWA tokens.');
      process.exit(1);
    }
    console.log('  ✅ Whitelisted');

    // b. Get asset (USDT) address and fee contract
    const assetAddr = await vault.asset();
    const assetInfo = await getTokenInfo(assetAddr, wallet);
    const feeAddr = await vault.rwaFee();
    const feeContract = new ethers.Contract(feeAddr, FEE_ABI, wallet);

    // c. Reverse-calculate USDT needed for desired KAI shares
    const grossAssets: bigint = await vault.convertToAssets(amountBN);
    let entryFee = 0n;
    try {
      entryFee = await feeContract.feeOnRaw(grossAssets, 0);
    } catch {
      // Fee contract may revert if not configured — default to 0
    }
    const totalSpend = grossAssets + entryFee;

    // d. Preview to confirm
    const previewShares = await vault.previewDeposit(totalSpend);

    console.log(`  Asset token:     ${assetAddr} (${assetInfo.symbol})`);
    console.log(`  Gross assets:    ${ethers.formatUnits(grossAssets, assetInfo.decimals)} ${assetInfo.symbol}`);
    console.log(`  Entry fee:       ${ethers.formatUnits(entryFee, assetInfo.decimals)} ${assetInfo.symbol}`);
    console.log(`  Total spend:     ${ethers.formatUnits(totalSpend, assetInfo.decimals)} ${assetInfo.symbol}`);
    console.log(`  Preview shares:  ${ethers.formatUnits(previewShares, srcTokenInfo.decimals)} ${srcTokenInfo.symbol}`);

    // e. Check USDT balance
    const assetToken = new ethers.Contract(assetAddr, ERC20_ABI, wallet);
    const assetBalance = await assetToken.balanceOf(senderAddress);
    console.log(`  ${assetInfo.symbol} balance: ${ethers.formatUnits(assetBalance, assetInfo.decimals)}`);
    if (assetBalance < totalSpend) {
      console.error(
        `\n❌ Insufficient ${assetInfo.symbol} balance. Have ${ethers.formatUnits(assetBalance, assetInfo.decimals)}, need ${ethers.formatUnits(totalSpend, assetInfo.decimals)}`,
      );
      process.exit(1);
    }

    // f. Approve USDT to vault
    await ensureAllowance(assetAddr, vaultAddr, totalSpend, wallet, srcChain.explorerTxUrl, assetInfo.symbol);

    // g. Deposit
    console.log(`  Depositing ${ethers.formatUnits(totalSpend, assetInfo.decimals)} ${assetInfo.symbol} into vault...`);
    const depositTx = await vault.deposit(totalSpend, senderAddress);
    console.log(`  📤 Deposit tx: ${srcChain.explorerTxUrl}${depositTx.hash}`);
    const depositReceipt = await depositTx.wait();

    if (depositReceipt.status !== 1) {
      console.error('\n❌ Vault deposit reverted!');
      process.exit(1);
    }

    console.log(`  ✅ Minted ${ethers.formatUnits(previewShares, srcTokenInfo.decimals)} ${srcTokenInfo.symbol} (block ${depositReceipt.blockNumber})`);
    printSeparator();
  }

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

  const hasFee = quotes.length >= 3 && quotes[2].amount > 0n;
  const feeTokenAddr = hasFee ? quotes[2].token : undefined;
  const feeAmount = hasFee ? quotes[2].amount : 0n;

  // Use source token info already fetched
  const transferInfo = srcTokenInfo;

  console.log(
    `  Gas quote:       ${ethers.formatEther(gasPayment)} native token`,
  );
  console.log(
    `  Transfer token:  ${transferTokenAddr} (${transferInfo.symbol})`,
  );
  console.log(
    `  Transfer amount: ${ethers.formatUnits(transferTokenAmount, transferInfo.decimals)} ${transferInfo.symbol}`,
  );

  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    console.log(
      `  Fee token:       ${feeTokenAddr} (${feeInfo.symbol})`,
    );
    console.log(
      `  Fee amount:      ${ethers.formatUnits(feeAmount, feeInfo.decimals)} ${feeInfo.symbol}`,
    );
  } else {
    console.log('  Fee:             None');
  }

  // ── Pre-flight checks ──────────────────────────────────────
  console.log('\n🔍 Pre-flight checks...');

  const nativeBalance = await provider.getBalance(senderAddress);
  console.log(
    `  Native balance:  ${ethers.formatEther(nativeBalance)}`,
  );
  if (nativeBalance < gasPayment) {
    console.error(
      `\n❌ Insufficient native balance for gas payment. Have ${ethers.formatEther(nativeBalance)}, need ${ethers.formatEther(gasPayment)}`,
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
    `  ${transferInfo.symbol} balance: ${ethers.formatUnits(transferBalance, transferInfo.decimals)}`,
  );
  if (transferBalance < transferTokenAmount) {
    console.error(
      `\n❌ Insufficient ${transferInfo.symbol} balance. Have ${ethers.formatUnits(transferBalance, transferInfo.decimals)}, need ${ethers.formatUnits(transferTokenAmount, transferInfo.decimals)}`,
    );
    process.exit(1);
  }

  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    const feeToken = new ethers.Contract(feeTokenAddr, ERC20_ABI, wallet);
    const feeBalance = await feeToken.balanceOf(senderAddress);
    console.log(
      `  ${feeInfo.symbol} balance: ${ethers.formatUnits(feeBalance, feeInfo.decimals)} (fee token)`,
    );
    if (feeBalance < feeAmount) {
      console.error(
        `\n❌ Insufficient ${feeInfo.symbol} balance for fee. Have ${ethers.formatUnits(feeBalance, feeInfo.decimals)}, need ${ethers.formatUnits(feeAmount, feeInfo.decimals)}`,
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
      formatted: ethers.formatUnits(transferTokenAmount, transferInfo.decimals),
    },
    gasQuote: {
      raw: gasPayment.toString(),
      formatted: ethers.formatEther(gasPayment),
    },
  };

  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    flowLog.feeToken = {
      address: feeTokenAddr,
      symbol: feeInfo.symbol,
      decimals: feeInfo.decimals,
      amount: feeAmount.toString(),
      formatted: ethers.formatUnits(feeAmount, feeInfo.decimals),
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
  console.log(`  value:       ${ethers.formatEther(gasPayment)}`);

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
    `  Bridged ${ethers.formatUnits(amountBN, transferInfo.decimals)} ${transferInfo.symbol} from ${srcChain.name} → ${dstChain.name}`,
  );
  if (hasFee && feeTokenAddr) {
    const feeInfo = await getTokenInfo(feeTokenAddr, wallet);
    console.log(
      `  Fee paid: ${ethers.formatUnits(feeAmount, feeInfo.decimals)} ${feeInfo.symbol}`,
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
