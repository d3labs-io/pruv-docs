require("dotenv").config();
const { ethers } = require("ethers");

const rwaAbi = require("./abis/RWAToken.json").abi;
const feeAbi = require("./abis/RWAFee.json").abi;

/**
 * Read-only information script.
 *
 * Purpose:
 * - show deposit preview information
 * - show redeem preview information
 * - show convertToAssets information
 *
 * Usage:
 *   node price.js [desiredAssetsBeforeFee] [shares]
 *
 * Example:
 *   node price.js 100 25
 */
function getEnv() {
  const env = {
    RPC_URL: process.env.RPC_URL,
    RWA_TOKEN_ADDRESS: process.env.RWA_TOKEN_ADDRESS,
    FEE_ADDRESS: process.env.FEE_ADDRESS || "",
    ENTRY_FEE_TIMING: Number(process.env.ENTRY_FEE_TIMING || 0),
    EXIT_FEE_TIMING: Number(process.env.EXIT_FEE_TIMING || 1),
  };

  if (!env.RPC_URL || !env.RWA_TOKEN_ADDRESS) {
    throw new Error("Missing required env values. Please check .env.example");
  }

  return env;
}

async function resolveFeeAddress(vault, env) {
  if (env.FEE_ADDRESS) return env.FEE_ADDRESS;

  const feeAddress = await vault.rwaFee();
  if (!feeAddress || feeAddress === ethers.ZeroAddress) {
    throw new Error("Fee address is not configured. Set FEE_ADDRESS or ensure vault.rwaFee() returns a valid address.");
  }

  return feeAddress;
}

async function main() {
  const desiredAssetsInput = process.argv[2] || "100";
  const sharesInput = process.argv[3] || "25";

  const env = getEnv();

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const vault = new ethers.Contract(env.RWA_TOKEN_ADDRESS, rwaAbi, provider);

  const assetAddress = await vault.asset();
  const asset = new ethers.Contract(
    assetAddress,
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)"
    ],
    provider
  );

  const shareDecimals = await vault.decimals();
  const shareSymbol = await vault.symbol();
  const assetDecimals = await asset.decimals();
  const assetSymbol = await asset.symbol();

  const feeAddress = await resolveFeeAddress(vault, env);
  const feeContract = new ethers.Contract(feeAddress, feeAbi, provider);

  const desiredAssets = ethers.parseUnits(desiredAssetsInput, assetDecimals);
  const shares = ethers.parseUnits(sharesInput, shareDecimals);

  // Deposit info: user enters desired assets before fee
  const entryFee = await feeContract.feeOnRaw(desiredAssets, env.ENTRY_FEE_TIMING);
  const totalSpend = desiredAssets + entryFee;
  const previewDepositShares = await vault.previewDeposit(totalSpend);

  // Redeem info: previewRedeem already represents final net
  const grossAssets = await vault.convertToAssets(shares);
  const estimatedExitFee = await feeContract.feeOnTotal(grossAssets, env.EXIT_FEE_TIMING);
  const previewRedeemNetAssets = await vault.previewRedeem(shares);

  console.log("=== PRICE / INFO FLOW ===");
  console.log("Vault:", env.RWA_TOKEN_ADDRESS);
  console.log("Fee contract:", feeAddress);
  console.log("");

  console.log("--- Deposit information ---");
  console.log("Desired assets before fee:", desiredAssetsInput, assetSymbol);
  console.log("Entry fee (feeOnRaw):", ethers.formatUnits(entryFee, assetDecimals), assetSymbol);
  console.log("Total spend sent to deposit():", ethers.formatUnits(totalSpend, assetDecimals), assetSymbol);
  console.log("previewDeposit(totalSpend):", ethers.formatUnits(previewDepositShares, shareDecimals), shareSymbol);
  console.log("");

  console.log("--- Redeem information ---");
  console.log("Input shares:", sharesInput, shareSymbol);
  console.log("convertToAssets(shares) [gross info]:", ethers.formatUnits(grossAssets, assetDecimals), assetSymbol);
  console.log("Estimated exit fee (feeOnTotal):", ethers.formatUnits(estimatedExitFee, assetDecimals), assetSymbol);
  console.log("previewRedeem(shares) [final net]:", ethers.formatUnits(previewRedeemNetAssets, assetDecimals), assetSymbol);
  console.log("");

  console.log("--- Direct price info ---");
  console.log("convertToAssets(", sharesInput, "):", ethers.formatUnits(grossAssets, assetDecimals), assetSymbol);
}

main().catch((error) => {
  console.error("Price/info flow failed:", error.shortMessage || error.message || error);
  process.exit(1);
});
