import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

import {
  KAIA, PRUV,
  ERC20_ABI, WARP_ROUTE_ABI, VAULT_ABI,
} from './config';
import { FlowLog, Quote } from './types';
import {
  addressToBytes32, printSeparator, getTokenInfo,
  ensureAllowance, getWrappedToken,
} from './helpers';
import { appendToOutputMd } from './flow-logger';
import { waitForRelayedMessage } from './relay-listener';

// Load .env from scripts directory (one level up from src/)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// ============ Redeem Flow ============
//
// Phase 1: Bridge RWA from Kaia → Pruv (RWA warp route)
// Phase 2: Redeem RWA tokens via vault on Pruv to get USDT back
// Phase 3: Bridge USDT from Pruv → Kaia (USDT warp route)

async function redeemFlow(): Promise<void> {
  // ── Parse args ──
  const args = parseArgs();
  const privateKey = args.privateKey;
  const rwaAmount = args.tokenAmount;
  const recipientOverride = args.recipient;

  // ── Wallets ──
  const kaiaProvider = new ethers.JsonRpcProvider(KAIA.rpcUrl);
  const pruvProvider = new ethers.JsonRpcProvider(PRUV.rpcUrl);
  const kaiaWallet = new ethers.Wallet(privateKey, kaiaProvider);
  const pruvWallet = new ethers.Wallet(privateKey, pruvProvider);
  const senderAddress = kaiaWallet.address;
  const recipientAddress = recipientOverride || senderAddress;

  // ── Resolve RWA token on Kaia ──
  // On Kaia, the RWA warp route IS the synthetic token (HypERC20)
  const rwaTokenKaia = KAIA.rwaWarpRoute;
  const rwaInfo = await getTokenInfo(rwaTokenKaia, kaiaProvider);
  const rwaAmountBN = ethers.parseUnits(rwaAmount, rwaInfo.decimals);

  printSeparator();
  console.log('🔄 PRUV Redeem Flow — RWA → USDT → Kaia');
  printSeparator();
  console.log(`  Sender:       ${senderAddress}`);
  console.log(`  Recipient:    ${recipientAddress}`);
  console.log(`  RWA Amount:   ${rwaAmount} ${rwaInfo.symbol}`);
  console.log(`  Raw amount:   ${rwaAmountBN.toString()} (${rwaInfo.decimals} decimals)`);
  printSeparator();

  // Initialize flow log
  const flowLog: FlowLog = {
    timestamp: new Date().toISOString(),
    sender: senderAddress,
    recipient: recipientAddress,
    rwaAmount,
    rwaAmountRaw: rwaAmountBN.toString(),
    phase1: {
      sourceChain: KAIA.name,
      destinationChain: PRUV.name,
      tokenAddress: rwaTokenKaia,
      tokenSymbol: rwaInfo.symbol,
      gasQuote: { raw: '0', formatted: '0' },
    },
    phase2: {
      vaultAddress: PRUV.vaultAddress!,
      rwaTokenAddress: '',
      rwaTokenSymbol: '',
      sharesRedeemed: rwaAmount,
      sharesRedeemedRaw: rwaAmountBN.toString(),
    },
    phase3: {
      sourceChain: PRUV.name,
      destinationChain: KAIA.name,
      tokenAddress: '',
      tokenSymbol: '',
      usdtAmount: '',
      usdtAmountRaw: '',
      gasQuote: { raw: '0', formatted: '0' },
    },
  };

  // ╔════════════════════════════════════════╗
  // ║  PHASE 1: Bridge RWA Kaia → Pruv      ║
  // ╚════════════════════════════════════════╝
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 1: Bridge RWA from Kaia → Pruv                ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const rwaWarpKaia = new ethers.Contract(KAIA.rwaWarpRoute, WARP_ROUTE_ABI, kaiaWallet);
  const recipientB32 = addressToBytes32(recipientAddress);

  // Step 1.1: Approve RWA token to warp route
  // On Kaia, the warp route IS the token (HypERC20 synthetic), so approve to itself
  console.log('📝 Step 1.1: Approve RWA token for warp route...');
  flowLog.phase1.approvalTxHash = await ensureAllowance(
    rwaTokenKaia,
    KAIA.rwaWarpRoute,
    rwaAmountBN,
    kaiaWallet,
    KAIA.explorerTxUrl,
    'RWA warp route (Kaia)',
  );

  // Step 1.2: Quote gas
  console.log('\n💰 Step 1.2: Quote interchain gas...');
  const rwaQuoteRaw: any[] = await rwaWarpKaia.quoteTransferRemote(
    PRUV.domainId,
    recipientB32,
    rwaAmountBN,
  );
  const rwaQuotes: Quote[] = rwaQuoteRaw.map((q: any) => ({
    token: q.token ?? q[0],
    amount: BigInt(q.amount ?? q[1]),
  }));

  let rwaGasValue = 0n;
  for (const q of rwaQuotes) {
    if (q.token === ethers.ZeroAddress) {
      rwaGasValue += q.amount;
      console.log(`  Native gas: ${ethers.formatEther(q.amount)} KAIA`);
    }
  }
  flowLog.phase1.gasQuote = {
    raw: rwaGasValue.toString(),
    formatted: `${ethers.formatEther(rwaGasValue)} KAIA`,
  };

  // Step 1.3: Send transferRemote
  console.log('\n🚀 Step 1.3: Sending RWA transferRemote (Kaia → Pruv)...');
  const rwaTransferTx = await rwaWarpKaia.transferRemote(
    PRUV.domainId,
    recipientB32,
    rwaAmountBN,
    { value: rwaGasValue },
  );
  console.log(`  Tx hash: ${KAIA.explorerTxUrl}${rwaTransferTx.hash}`);
  flowLog.phase1.transferTxHash = rwaTransferTx.hash;

  const rwaReceipt = await rwaTransferTx.wait();
  flowLog.phase1.transferBlock = rwaReceipt!.blockNumber;
  flowLog.phase1.transferGasUsed = rwaReceipt!.gasUsed.toString();
  flowLog.phase1.transferStatus = rwaReceipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(`  ✅ Status: ${flowLog.phase1.transferStatus} (block ${rwaReceipt!.blockNumber})`);

  if (flowLog.phase1.transferStatus === 'Reverted') {
    console.error('❌ Phase 1 transfer reverted. Aborting redeem flow.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }

  // Step 1.4: Wait for relay on Pruv
  console.log('\n⏳ Step 1.4: Waiting for RWA relay on Pruv...');
  const rwaTokenPruv = await getWrappedToken(PRUV.rwaWarpRoute, pruvProvider);
  const rwaInfoPruv = await getTokenInfo(rwaTokenPruv, pruvWallet);
  flowLog.phase2.rwaTokenAddress = rwaTokenPruv;
  flowLog.phase2.rwaTokenSymbol = rwaInfoPruv.symbol;

  const rwaRelayResult = await waitForRelayedMessage(
    PRUV,
    PRUV.rwaWarpRoute,
    KAIA.domainId,
    recipientAddress,
    rwaInfoPruv,
  );

  flowLog.phase1.relayTxHash = rwaRelayResult.txHash;
  flowLog.phase1.relayBlock = rwaRelayResult.blockNumber;
  flowLog.phase1.relayStatus = rwaRelayResult.status;

  if (rwaRelayResult.status === 'Timeout') {
    console.error('❌ Phase 1 relay timed out. RWA may still arrive. Aborting redeem flow.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }

  // ╔════════════════════════════════════════╗
  // ║  PHASE 2: Redeem RWA → USDT on Pruv   ║
  // ╚════════════════════════════════════════╝
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 2: Redeem RWA → USDT via Vault on Pruv        ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const vaultAddr = PRUV.vaultAddress!;
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, pruvWallet);

  // Step 2.1: Preview redeem
  console.log('📊 Step 2.1: Preview redeem...');
  const vaultDecimals = await vault.decimals();
  const vaultSymbol = await vault.symbol();
  const assetAddr = await vault.asset();
  const assetInfo = await getTokenInfo(assetAddr, pruvWallet);

  flowLog.phase2.assetAddress = assetAddr;
  flowLog.phase2.assetSymbol = assetInfo.symbol;

  const expectedAssets = await vault.previewRedeem(rwaAmountBN);
  console.log(
    `  Expected assets: ${ethers.formatUnits(expectedAssets, assetInfo.decimals)} ${assetInfo.symbol}`,
  );
  console.log(`  Shares to redeem: ${rwaAmount} ${vaultSymbol}`);

  // Step 2.2: Execute vault redeem
  console.log('\n🏦 Step 2.2: Redeeming from vault...');
  const redeemTx = await vault.redeem(rwaAmountBN, senderAddress, senderAddress);
  console.log(`  Redeem tx: ${PRUV.explorerTxUrl}${redeemTx.hash}`);
  flowLog.phase2.redeemTxHash = redeemTx.hash;

  const redeemReceipt = await redeemTx.wait();
  flowLog.phase2.redeemBlock = redeemReceipt!.blockNumber;
  flowLog.phase2.redeemStatus = redeemReceipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(
    `  ✅ Redeem ${flowLog.phase2.redeemStatus} (block ${redeemReceipt!.blockNumber})`,
  );

  if (flowLog.phase2.redeemStatus === 'Reverted') {
    console.error('❌ Vault redeem reverted. Aborting redeem flow.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }

  // Read the USDT balance we got from redemption
  const usdtToken = new ethers.Contract(assetAddr, ERC20_ABI, pruvWallet);
  const usdtBalance = await usdtToken.balanceOf(senderAddress);
  // For safety, use the expected amount rather than total balance
  const usdtRedeemed = expectedAssets;
  flowLog.phase2.assetsReceived = ethers.formatUnits(usdtRedeemed, assetInfo.decimals);
  flowLog.phase2.assetsReceivedRaw = usdtRedeemed.toString();
  console.log(
    `  USDT received: ${flowLog.phase2.assetsReceived} ${assetInfo.symbol}`,
  );

  // ╔════════════════════════════════════════╗
  // ║  PHASE 3: Bridge USDT Pruv → Kaia     ║
  // ╚════════════════════════════════════════╝
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 3: Bridge USDT from Pruv → Kaia               ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Resolve the USDT token on Pruv via the warp route
  const usdtTokenPruv = await getWrappedToken(PRUV.usdtWarpRoute, pruvWallet);
  const usdtInfoPruv = await getTokenInfo(usdtTokenPruv, pruvWallet);

  flowLog.phase3.tokenAddress = usdtTokenPruv;
  flowLog.phase3.tokenSymbol = usdtInfoPruv.symbol;
  flowLog.phase3.usdtAmount = ethers.formatUnits(usdtRedeemed, usdtInfoPruv.decimals);
  flowLog.phase3.usdtAmountRaw = usdtRedeemed.toString();

  console.log(`  USDT token:  ${usdtTokenPruv} (${usdtInfoPruv.symbol})`);
  console.log(`  Amount:      ${flowLog.phase3.usdtAmount} ${usdtInfoPruv.symbol}`);

  const usdtWarpPruv = new ethers.Contract(PRUV.usdtWarpRoute, WARP_ROUTE_ABI, pruvWallet);
  const usdtRecipientB32 = addressToBytes32(recipientAddress);

  // Step 3.1: Quote gas & fees first (need to know total approvals)
  console.log('\n💰 Step 3.1: Quote interchain gas & fees...');
  const usdtQuoteRaw: any[] = await usdtWarpPruv.quoteTransferRemote(
    KAIA.domainId,
    usdtRecipientB32,
    usdtRedeemed,
  );
  const usdtQuotes: Quote[] = usdtQuoteRaw.map((q: any) => ({
    token: q.token ?? q[0],
    amount: BigInt(q.amount ?? q[1]),
  }));

  let usdtGasValue = 0n;
  // Track total USDT needed (transfer amount + any USDT fee from quote)
  let totalUsdtNeeded = usdtRedeemed;

  for (const q of usdtQuotes) {
    if (q.token === ethers.ZeroAddress) {
      usdtGasValue += q.amount;
      console.log(`  Native gas: ${ethers.formatEther(q.amount)} PRUV`);
    } else if (q.token.toLowerCase() === usdtTokenPruv.toLowerCase()) {
      // The USDT token itself is also a fee — add to total approval
      totalUsdtNeeded += q.amount;
      const feeFormatted = ethers.formatUnits(q.amount, usdtInfoPruv.decimals);
      console.log(`  USDT fee:   ${feeFormatted} ${usdtInfoPruv.symbol}`);
    } else {
      // Different ERC20 fee token (e.g., USDC)
      const feeInfo = await getTokenInfo(q.token, pruvWallet);
      const feeFormatted = ethers.formatUnits(q.amount, feeInfo.decimals);
      console.log(`  Fee token:  ${feeFormatted} ${feeInfo.symbol} (${q.token})`);

      // Approve fee token
      console.log(`\n📝 Approve fee token (${feeInfo.symbol}) for warp route...`);
      await ensureAllowance(
        q.token,
        PRUV.usdtWarpRoute,
        q.amount,
        pruvWallet,
        PRUV.explorerTxUrl,
        `Fee token ${feeInfo.symbol} (USDT warp route)`,
      );
    }
  }
  flowLog.phase3.gasQuote = {
    raw: usdtGasValue.toString(),
    formatted: `${ethers.formatEther(usdtGasValue)} PRUV`,
  };
  console.log(`  Total USDT needed (transfer + fee): ${ethers.formatUnits(totalUsdtNeeded, usdtInfoPruv.decimals)} ${usdtInfoPruv.symbol}`);

  // Step 3.2: Approve USDT to warp route (full amount including fees)
  console.log('\n📝 Step 3.2: Approve USDT for warp route...');
  flowLog.phase3.approvalTxHash = await ensureAllowance(
    usdtTokenPruv,
    PRUV.usdtWarpRoute,
    totalUsdtNeeded,
    pruvWallet,
    PRUV.explorerTxUrl,
    'USDT warp route (Pruv)',
  );

  // Step 3.3: Send transferRemote
  console.log('\n🚀 Step 3.3: Sending USDT transferRemote (Pruv → Kaia)...');
  const usdtTransferTx = await usdtWarpPruv.transferRemote(
    KAIA.domainId,
    usdtRecipientB32,
    usdtRedeemed,
    { value: usdtGasValue },
  );
  console.log(`  Tx hash: ${PRUV.explorerTxUrl}${usdtTransferTx.hash}`);
  flowLog.phase3.transferTxHash = usdtTransferTx.hash;

  const usdtReceipt = await usdtTransferTx.wait();
  flowLog.phase3.transferBlock = usdtReceipt!.blockNumber;
  flowLog.phase3.transferGasUsed = usdtReceipt!.gasUsed.toString();
  flowLog.phase3.transferStatus = usdtReceipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(`  ✅ Status: ${flowLog.phase3.transferStatus} (block ${usdtReceipt!.blockNumber})`);

  // Step 3.4: Wait for relay on Kaia
  console.log('\n⏳ Step 3.4: Waiting for USDT relay on Kaia...');
  const usdtTokenKaia = await getWrappedToken(KAIA.usdtWarpRoute, kaiaWallet);
  const usdtInfoKaia = await getTokenInfo(usdtTokenKaia, kaiaWallet);
  const usdtRelayResult = await waitForRelayedMessage(
    KAIA,
    KAIA.usdtWarpRoute,
    PRUV.domainId,
    recipientAddress,
    usdtInfoKaia,
  );

  flowLog.phase3.relayTxHash = usdtRelayResult.txHash;
  flowLog.phase3.relayBlock = usdtRelayResult.blockNumber;
  flowLog.phase3.relayStatus = usdtRelayResult.status;

  // ── Summary ──
  printSeparator();
  console.log('✅ REDEEM FLOW COMPLETE');
  printSeparator();
  console.log(`  Phase 1: RWA bridged Kaia → Pruv     [${flowLog.phase1.relayStatus}]`);
  console.log(`  Phase 2: RWA redeemed → USDT on Pruv [${flowLog.phase2.redeemStatus}]`);
  console.log(`  Phase 3: USDT bridged Pruv → Kaia    [${flowLog.phase3.relayStatus}]`);
  printSeparator();

  appendToOutputMd(flowLog);
}

// ============ Arg Parsing ============

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '').replace(/-/g, '_');
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      parsed[key] = value;
    }
  }

  const privateKey = parsed.private_key || process.env.PRIVATE_KEY;
  const tokenAmount = parsed.token_amount || parsed.amount || process.env.TOKEN_AMOUNT;
  const recipient = parsed.recipient || process.env.RECIPIENT || undefined;

  if (!privateKey) {
    console.error('❌ Missing PRIVATE_KEY (set via .env or --private-key)');
    process.exit(1);
  }
  if (!tokenAmount) {
    console.error('❌ Missing TOKEN_AMOUNT (set via .env or --token-amount / --amount)');
    process.exit(1);
  }

  // Validate private key
  try {
    new ethers.Wallet(privateKey);
  } catch {
    console.error('❌ Invalid private key format');
    process.exit(1);
  }

  return { privateKey, tokenAmount, recipient };
}

// ============ Entry Point ============

redeemFlow().catch((err) => {
  console.error('\n❌ Redeem flow failed:', err.message || err);
  process.exit(1);
});
