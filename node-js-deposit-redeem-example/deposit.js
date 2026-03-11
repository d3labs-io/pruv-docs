require("dotenv").config();
const { ethers } = require("ethers");

/**
 * IMPORTANT:
 * We intentionally access `.abi` from the JSON files because these files are
 * Hardhat-style artifacts, not plain ABI arrays.
 */
const rwaAbi = require("./abis/RWAToken.json").abi;
const whitelistAbi = require("./abis/Whitelist.json").abi;
const feeAbi = require("./abis/RWAFee.json").abi;

/**
 * Load and validate environment variables used by this flow.
 */
function getEnv() {
  const env = {
    RPC_URL: process.env.RPC_URL,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RWA_TOKEN_ADDRESS: process.env.RWA_TOKEN_ADDRESS,
    WHITELIST_ADDRESS: process.env.WHITELIST_ADDRESS,
    FEE_ADDRESS: process.env.FEE_ADDRESS || "",
    APPROVE_MAX: String(process.env.APPROVE_MAX || "false").toLowerCase() === "true",
    ENTRY_FEE_TIMING: Number(process.env.ENTRY_FEE_TIMING || 0),
  };

  if (!env.RPC_URL || !env.PRIVATE_KEY || !env.RWA_TOKEN_ADDRESS || !env.WHITELIST_ADDRESS) {
    throw new Error("Missing required env values. Please check .env.example");
  }

  return env;
}

/**
 * Resolve the fee contract address.
 *
 * Priority:
 * 1. use FEE_ADDRESS from env if provided
 * 2. fallback to vault.rwaFee() if env value is empty
 */
async function resolveFeeAddress(vault, env) {
  if (env.FEE_ADDRESS) {
    return env.FEE_ADDRESS;
  }

  const feeAddress = await vault.rwaFee();
  if (!feeAddress || feeAddress === ethers.ZeroAddress) {
    throw new Error("Fee address is not configured. Set FEE_ADDRESS or ensure vault.rwaFee() returns a valid address.");
  }

  return feeAddress;
}

/**
 * Main deposit flow.
 *
 * User input = desired assets before entry fee.
 *
 * We calculate:
 * - entryFee = feeOnRaw(desiredAssets, ENTRY)
 * - totalSpend = desiredAssets + entryFee
 *
 * Then we:
 * - check whitelist
 * - check balance >= totalSpend
 * - check allowance >= totalSpend
 * - optionally approve
 * - call deposit(totalSpend, receiver)
 *
 * previewDeposit(totalSpend) is shown so integrators can confirm the share output.
 */
async function main() {
  const desiredAssetsInput = process.argv[2];
  if (!desiredAssetsInput) {
    throw new Error("Usage: node deposit.js <desiredAssetsBeforeFee>");
  }

  const env = getEnv();

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(env.RWA_TOKEN_ADDRESS, rwaAbi, wallet);
  const whitelist = new ethers.Contract(env.WHITELIST_ADDRESS, whitelistAbi, wallet);

  const user = await wallet.getAddress();

  console.log("=== DEPOSIT FLOW (WITH ENTRY FEE) ===");
  console.log("User:", user);
  console.log("Vault:", env.RWA_TOKEN_ADDRESS);
  console.log("Whitelist:", env.WHITELIST_ADDRESS);

  // 1) Check whitelist
  const isWhitelisted = await whitelist.balanceOf(user, 1); // Token ID 1 is the relevant whitelist token
  console.log("Whitelisted:", isWhitelisted);
  if (!isWhitelisted) {
    throw new Error("User is not whitelisted.");
  }

  // 2) Load vault asset token
  const assetAddress = await vault.asset();
  const asset = new ethers.Contract(
    assetAddress,
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)"
    ],
    wallet
  );

  const assetDecimals = await asset.decimals();
  const assetSymbol = await asset.symbol();
  const desiredAssets = ethers.parseUnits(desiredAssetsInput, assetDecimals);

  // 3) Resolve and load fee contract
  const feeAddress = await resolveFeeAddress(vault, env);
  const feeContract = new ethers.Contract(feeAddress, feeAbi, wallet);

  const entryFee = await feeContract.feeOnRaw(desiredAssets, env.ENTRY_FEE_TIMING);
  const totalSpend = desiredAssets + entryFee;
  const previewShares = await vault.previewDeposit(totalSpend);

  const shareDecimals = await vault.decimals();
  const shareSymbol = await vault.symbol();

  console.log("Fee contract:", feeAddress);
  console.log("Desired assets before fee:", desiredAssetsInput, assetSymbol);
  console.log("Entry fee:", ethers.formatUnits(entryFee, assetDecimals), assetSymbol);
  console.log("Total spend sent to deposit():", ethers.formatUnits(totalSpend, assetDecimals), assetSymbol);
  console.log("previewDeposit(totalSpend):", ethers.formatUnits(previewShares, shareDecimals), shareSymbol);

  // 4) Check balance and allowance using TOTAL SPEND (assets + fee)
  const assetBalance = await asset.balanceOf(user);
  const allowance = await asset.allowance(user, env.RWA_TOKEN_ADDRESS);

  console.log("Wallet asset balance:", ethers.formatUnits(assetBalance, assetDecimals), assetSymbol);
  console.log("Allowance to vault:", ethers.formatUnits(allowance, assetDecimals), assetSymbol);

  if (assetBalance < totalSpend) {
    throw new Error("Not enough asset balance for desiredAssets + entryFee.");
  }

  if (allowance < totalSpend) {
    const approveAmount = env.APPROVE_MAX ? ethers.MaxUint256 : totalSpend;
    console.log("Allowance is not enough, sending approve()...");
    const approveTx = await asset.approve(env.RWA_TOKEN_ADDRESS, approveAmount);
    console.log("Approve tx:", approveTx.hash);
    await approveTx.wait();
    console.log("Approve confirmed.");
  } else {
    console.log("Allowance is already enough.");
  }

  // 5) Deposit total spend (desired assets + entry fee)
  console.log("Sending deposit(totalSpend, receiver)...");
  const tx = await vault.deposit(totalSpend, user);
  console.log("Deposit tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Deposit confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error("Deposit flow failed:", error.shortMessage || error.message || error);
  process.exit(1);
});
