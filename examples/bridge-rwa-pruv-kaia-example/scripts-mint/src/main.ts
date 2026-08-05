import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

import {
  KAIA, PRUV,
  ERC20_ABI, WARP_ROUTE_ABI, VAULT_ABI, WHITELIST_ABI, FEE_ABI,
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

// ============ Mint Flow ============
//
// Phase 1: Bridge USDT from Kaia → Pruv (USDT warp route)
// Phase 2: Deposit USDT into RWA vault on Pruv to mint RWA tokens
// Phase 3: Bridge RWA tokens from Pruv → Kaia (RWA warp route)

async function mintFlow(): Promise<void> {
  // ── Parse args ──
  const args = parseArgs();
  const privateKey = args.privateKey;
  const usdtAmount = args.tokenAmount;
  const recipientOverride = args.recipient;

  // ── Wallets ──
  const kaiaProvider = new ethers.JsonRpcProvider(KAIA.rpcUrl);
  const pruvProvider = new ethers.JsonRpcProvider(PRUV.rpcUrl);
  const kaiaWallet = new ethers.Wallet(privateKey, kaiaProvider);
  const pruvWallet = new ethers.Wallet(privateKey, pruvProvider);
  const senderAddress = kaiaWallet.address;
  const recipientAddress = recipientOverride || senderAddress;

  // ── Resolve USDT token on Kaia ──
  const usdtTokenKaia = await getWrappedToken(KAIA.usdtWarpRoute, kaiaWallet);
  const usdtInfo = await getTokenInfo(usdtTokenKaia, kaiaWallet);
  const usdtAmountBN = ethers.parseUnits(usdtAmount, usdtInfo.decimals);

  printSeparator();
  console.log('🏗️  PRUV Mint Flow — USDT → RWA → Kaia');
  printSeparator();
  console.log(`  Sender:       ${senderAddress}`);
  console.log(`  Recipient:    ${recipientAddress}`);
  console.log(`  USDT Amount:  ${usdtAmount} ${usdtInfo.symbol}`);
  console.log(`  Raw amount:   ${usdtAmountBN.toString()} (${usdtInfo.decimals} decimals)`);
  printSeparator();

  // Initialize flow log
  const flowLog: FlowLog = {
    timestamp: new Date().toISOString(),
    sender: senderAddress,
    recipient: recipientAddress,
    usdtAmount,
    usdtAmountRaw: usdtAmountBN.toString(),
    phase1: {
      sourceChain: KAIA.name,
      destinationChain: PRUV.name,
      tokenAddress: usdtTokenKaia,
      tokenSymbol: usdtInfo.symbol,
      gasQuote: { raw: '0', formatted: '0' },
    },
    phase2: {
      vaultAddress: PRUV.vaultAddress!,
      depositAsset: '',
      depositAssetSymbol: '',
      depositAmount: usdtAmount,
      depositAmountRaw: usdtAmountBN.toString(),
    },
    phase3: {
      sourceChain: PRUV.name,
      destinationChain: KAIA.name,
      tokenAddress: '',
      tokenSymbol: '',
      rwaAmount: '',
      rwaAmountRaw: '',
      gasQuote: { raw: '0', formatted: '0' },
    },
  };

  // ╔════════════════════════════════════════╗
  // ║  PHASE 1: Bridge USDT Kaia → Pruv     ║
  // ╚════════════════════════════════════════╝
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 1: Bridge USDT from Kaia → Pruv               ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const usdtWarpKaia = new ethers.Contract(KAIA.usdtWarpRoute, WARP_ROUTE_ABI, kaiaWallet);
  const recipientB32 = addressToBytes32(recipientAddress);

  // Step 1.1: Quote gas & fees first (need to know total approvals)
  console.log('💰 Step 1.1: Quote interchain gas & fees...');
  const usdtQuoteRaw: any[] = await usdtWarpKaia.quoteTransferRemote(
    PRUV.domainId,
    recipientB32,
    usdtAmountBN,
  );
  const usdtQuotes: Quote[] = usdtQuoteRaw.map((q: any) => ({
    token: q.token ?? q[0],
    amount: BigInt(q.amount ?? q[1]),
  }));

  let usdtGasValue = 0n;
  let totalUsdtNeeded = usdtAmountBN;

  for (const q of usdtQuotes) {
    if (q.token === ethers.ZeroAddress) {
      usdtGasValue += q.amount;
      console.log(`  Native gas: ${ethers.formatEther(q.amount)} KAIA`);
    } else if (q.token.toLowerCase() === usdtTokenKaia.toLowerCase()) {
      totalUsdtNeeded += q.amount;
      console.log(`  USDT fee:   ${ethers.formatUnits(q.amount, usdtInfo.decimals)} ${usdtInfo.symbol}`);
    } else {
      const feeInfo = await getTokenInfo(q.token, kaiaWallet);
      console.log(`  Fee token:  ${ethers.formatUnits(q.amount, feeInfo.decimals)} ${feeInfo.symbol} (${q.token})`);
      console.log(`\n📝 Approve fee token (${feeInfo.symbol}) for warp route...`);
      await ensureAllowance(q.token, KAIA.usdtWarpRoute, q.amount, kaiaWallet, KAIA.explorerTxUrl, `Fee ${feeInfo.symbol}`);
    }
  }
  flowLog.phase1.gasQuote = {
    raw: usdtGasValue.toString(),
    formatted: `${ethers.formatEther(usdtGasValue)} KAIA`,
  };
  console.log(`  Total USDT needed (transfer + fee): ${ethers.formatUnits(totalUsdtNeeded, usdtInfo.decimals)} ${usdtInfo.symbol}`);

  // Step 1.2: Approve USDT to warp route (full amount including fees)
  console.log('\n📝 Step 1.2: Approve USDT for USDT warp route...');
  flowLog.phase1.approvalTxHash = await ensureAllowance(
    usdtTokenKaia,
    KAIA.usdtWarpRoute,
    totalUsdtNeeded,
    kaiaWallet,
    KAIA.explorerTxUrl,
    'USDT warp route',
  );

  // Step 1.3: Send transferRemote
  console.log('\n🚀 Step 1.3: Sending USDT transferRemote (Kaia → Pruv)...');
  const usdtTransferTx = await usdtWarpKaia.transferRemote(
    PRUV.domainId,
    recipientB32,
    usdtAmountBN,
    { value: usdtGasValue },
  );
  console.log(`  Tx hash: ${KAIA.explorerTxUrl}${usdtTransferTx.hash}`);
  flowLog.phase1.transferTxHash = usdtTransferTx.hash;

  const usdtReceipt = await usdtTransferTx.wait();
  flowLog.phase1.transferBlock = usdtReceipt!.blockNumber;
  flowLog.phase1.transferGasUsed = usdtReceipt!.gasUsed.toString();
  flowLog.phase1.transferStatus = usdtReceipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(`  ✅ Status: ${flowLog.phase1.transferStatus} (block ${usdtReceipt!.blockNumber})`);

  if (flowLog.phase1.transferStatus === 'Reverted') {
    console.error('❌ Phase 1 transfer reverted. Aborting mint flow.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }

  // Step 1.4: Wait for relay on Pruv
  console.log('\n⏳ Step 1.4: Waiting for USDT relay on Pruv...');
  const usdtTokenPruv = await getWrappedToken(PRUV.usdtWarpRoute, pruvProvider);
  const usdtInfoPruv = await getTokenInfo(usdtTokenPruv, pruvWallet);
  const usdtRelayResult = await waitForRelayedMessage(
    PRUV,
    PRUV.usdtWarpRoute,
    KAIA.domainId,
    recipientAddress,
    usdtInfoPruv,
    usdtAmount,
  );

  flowLog.phase1.relayTxHash = usdtRelayResult.txHash;
  flowLog.phase1.relayBlock = usdtRelayResult.blockNumber;
  flowLog.phase1.relayStatus = usdtRelayResult.status;

  if (usdtRelayResult.status === 'Timeout') {
    console.error('❌ Phase 1 relay timed out. USDT may still arrive. Aborting mint flow.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }

  // ╔════════════════════════════════════════╗
  // ║  PHASE 2: Mint RWA on Pruv            ║
  // ╚════════════════════════════════════════╝
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 2: Mint RWA via Vault Deposit on Pruv         ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const vaultAddr = PRUV.vaultAddress!;
  const whitelistAddr = PRUV.whitelistAddress!;

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, pruvWallet);

  // Step 2.1: Check whitelist
  console.log('📋 Step 2.1: Checking whitelist...');
  const whitelist = new ethers.Contract(whitelistAddr, WHITELIST_ABI, pruvWallet);
  const wlBalance = await whitelist.balanceOf(senderAddress, 1);
  if (wlBalance === 0n) {
    console.error('❌ Address not whitelisted for vault deposit. Aborting.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }
  console.log(`  ✅ Whitelisted (balance: ${wlBalance.toString()})`);

  // Step 2.2: Resolve deposit asset (USDT on Pruv via vault.asset())
  console.log('\n🔍 Step 2.2: Resolving vault deposit asset...');
  const depositAssetAddr = await vault.asset();
  const depositAssetInfo = await getTokenInfo(depositAssetAddr, pruvWallet);
  flowLog.phase2.depositAsset = depositAssetAddr;
  flowLog.phase2.depositAssetSymbol = depositAssetInfo.symbol;
  console.log(`  Deposit asset: ${depositAssetAddr} (${depositAssetInfo.symbol})`);

  // The amount to deposit = the USDT that was bridged
  const depositAmountBN = ethers.parseUnits(usdtAmount, depositAssetInfo.decimals);

  // Step 2.3: Check deposit fee
  console.log('\n💰 Step 2.3: Checking deposit fee...');
  try {
    const feeAddr = await vault.rwaFee();
    const feeContract = new ethers.Contract(feeAddr, FEE_ABI, pruvWallet);
    const fee = await feeContract.feeOnRaw(depositAmountBN, 0);
    console.log(
      `  Fee: ${ethers.formatUnits(fee, depositAssetInfo.decimals)} ${depositAssetInfo.symbol}`,
    );
  } catch {
    console.log('  No fee contract or fee = 0');
  }

  // Step 2.4: Preview deposit
  console.log('\n📊 Step 2.4: Preview deposit...');
  const expectedShares = await vault.previewDeposit(depositAmountBN);
  const vaultDecimals = await vault.decimals();
  const vaultSymbol = await vault.symbol();
  console.log(
    `  Expected shares: ${ethers.formatUnits(expectedShares, vaultDecimals)} ${vaultSymbol}`,
  );

  // Step 2.5: Approve deposit asset to vault
  console.log('\n📝 Step 2.5: Approve deposit asset for vault...');
  flowLog.phase2.depositApprovalTxHash = await ensureAllowance(
    depositAssetAddr,
    vaultAddr,
    depositAmountBN,
    pruvWallet,
    PRUV.explorerTxUrl,
    'Vault',
  );

  // Step 2.6: Execute vault deposit
  console.log('\n🏦 Step 2.6: Depositing into vault...');
  const depositTx = await vault.deposit(depositAmountBN, senderAddress);
  console.log(`  Deposit tx: ${PRUV.explorerTxUrl}${depositTx.hash}`);
  flowLog.phase2.depositTxHash = depositTx.hash;

  const depositReceipt = await depositTx.wait();
  flowLog.phase2.depositBlock = depositReceipt!.blockNumber;
  flowLog.phase2.depositStatus = depositReceipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(
    `  ✅ Deposit ${flowLog.phase2.depositStatus} (block ${depositReceipt!.blockNumber})`,
  );

  if (flowLog.phase2.depositStatus === 'Reverted') {
    console.error('❌ Vault deposit reverted. Aborting mint flow.');
    appendToOutputMd(flowLog);
    process.exit(1);
  }

  // Read shares from vault balance (vault IS the RWA token)
  const sharesBalance = await vault.balanceOf(senderAddress);
  flowLog.phase2.sharesReceived = ethers.formatUnits(sharesBalance, vaultDecimals);
  flowLog.phase2.sharesReceivedRaw = sharesBalance.toString();
  flowLog.phase2.rwaTokenAddress = vaultAddr;
  flowLog.phase2.rwaTokenSymbol = vaultSymbol;
  console.log(
    `  Vault balance: ${flowLog.phase2.sharesReceived} ${vaultSymbol}`,
  );

  // ╔════════════════════════════════════════╗
  // ║  PHASE 3: Bridge RWA Pruv → Kaia      ║
  // ╚════════════════════════════════════════╝
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 3: Bridge RWA from Pruv → Kaia                ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Resolve the RWA token that the warp route wraps
  const rwaTokenPruv = await getWrappedToken(PRUV.rwaWarpRoute, pruvWallet);
  const rwaInfo = await getTokenInfo(rwaTokenPruv, pruvWallet);
  flowLog.phase3.tokenAddress = rwaTokenPruv;
  flowLog.phase3.tokenSymbol = rwaInfo.symbol;

  // Use the shares we just minted as the bridge amount
  const rwaAmountBN = sharesBalance;
  flowLog.phase3.rwaAmount = ethers.formatUnits(rwaAmountBN, rwaInfo.decimals);
  flowLog.phase3.rwaAmountRaw = rwaAmountBN.toString();

  console.log(`  RWA token:   ${rwaTokenPruv} (${rwaInfo.symbol})`);
  console.log(`  Amount:      ${flowLog.phase3.rwaAmount} ${rwaInfo.symbol}`);

  const rwaWarpPruv = new ethers.Contract(PRUV.rwaWarpRoute, WARP_ROUTE_ABI, pruvWallet);

  // Step 3.1: Approve RWA token to warp route
  console.log('\n📝 Step 3.1: Approve RWA token for warp route...');
  flowLog.phase3.approvalTxHash = await ensureAllowance(
    rwaTokenPruv,
    PRUV.rwaWarpRoute,
    rwaAmountBN,
    pruvWallet,
    PRUV.explorerTxUrl,
    'RWA warp route',
  );

  // Step 3.2: Check and approve fee token (HypERC20CollateralWithFee)
  console.log('\n💰 Step 3.2: Quote interchain gas & check fee...');
  const rwaRecipientB32 = addressToBytes32(recipientAddress);
  const rwaQuoteRaw: any[] = await rwaWarpPruv.quoteTransferRemote(
    KAIA.domainId,
    rwaRecipientB32,
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
      console.log(`  Native gas: ${ethers.formatEther(q.amount)} PRUV`);
    } else {
      // ERC20 fee token (e.g., USDC on Pruv)
      const feeInfo = await getTokenInfo(q.token, pruvWallet);
      const feeFormatted = ethers.formatUnits(q.amount, feeInfo.decimals);
      console.log(`  Fee token:  ${feeFormatted} ${feeInfo.symbol} (${q.token})`);

      flowLog.phase3.feeToken = {
        address: q.token,
        symbol: feeInfo.symbol,
        decimals: feeInfo.decimals,
        amount: q.amount.toString(),
        formatted: `${feeFormatted} ${feeInfo.symbol}`,
      };

      // Approve fee token
      flowLog.phase3.feeApprovalTxHash = await ensureAllowance(
        q.token,
        PRUV.rwaWarpRoute,
        q.amount,
        pruvWallet,
        PRUV.explorerTxUrl,
        'Fee token (RWA warp route)',
      );
    }
  }
  flowLog.phase3.gasQuote = {
    raw: rwaGasValue.toString(),
    formatted: `${ethers.formatEther(rwaGasValue)} PRUV`,
  };

  // Step 3.3: Send transferRemote
  console.log('\n🚀 Step 3.3: Sending RWA transferRemote (Pruv → Kaia)...');
  const rwaTransferTx = await rwaWarpPruv.transferRemote(
    KAIA.domainId,
    rwaRecipientB32,
    rwaAmountBN,
    { value: rwaGasValue },
  );
  console.log(`  Tx hash: ${PRUV.explorerTxUrl}${rwaTransferTx.hash}`);
  flowLog.phase3.transferTxHash = rwaTransferTx.hash;

  const rwaReceipt = await rwaTransferTx.wait();
  flowLog.phase3.transferBlock = rwaReceipt!.blockNumber;
  flowLog.phase3.transferGasUsed = rwaReceipt!.gasUsed.toString();
  flowLog.phase3.transferStatus = rwaReceipt!.status === 1 ? 'Success' : 'Reverted';
  console.log(`  ✅ Status: ${flowLog.phase3.transferStatus} (block ${rwaReceipt!.blockNumber})`);

  // Step 3.4: Wait for relay on Kaia
  console.log('\n⏳ Step 3.4: Waiting for RWA relay on Kaia...');
  const rwaInfoKaia = await getTokenInfo(KAIA.rwaWarpRoute, kaiaProvider);
  const rwaRelayResult = await waitForRelayedMessage(
    KAIA,
    KAIA.rwaWarpRoute,
    PRUV.domainId,
    recipientAddress,
    rwaInfoKaia,
    flowLog.phase3.rwaAmount,
  );

  flowLog.phase3.relayTxHash = rwaRelayResult.txHash;
  flowLog.phase3.relayBlock = rwaRelayResult.blockNumber;
  flowLog.phase3.relayStatus = rwaRelayResult.status;

  // ── Summary ──
  printSeparator();
  console.log('✅ MINT FLOW COMPLETE');
  printSeparator();
  console.log(`  Phase 1: USDT bridged Kaia → Pruv   [${flowLog.phase1.relayStatus}]`);
  console.log(`  Phase 2: RWA minted on Pruv          [${flowLog.phase2.depositStatus}]`);
  console.log(`  Phase 3: RWA bridged Pruv → Kaia     [${flowLog.phase3.relayStatus}]`);
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

mintFlow().catch((err) => {
  console.error('\n❌ Mint flow failed:', err.message || err);
  process.exit(1);
});
