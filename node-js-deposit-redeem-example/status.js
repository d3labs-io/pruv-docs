require("dotenv").config();
const { ethers } = require("ethers");

const rwaAbi = require("./abis/RWAToken.json").abi;
const whitelistAbi = require("./abis/Whitelist.json").abi;
const feeAbi = require("./abis/RWAFee.json").abi;

/**
 * Status script for pre-flight checks and previews.
 *
 * This is useful when integrators want to inspect everything before calling
 * deposit or redeem from their own backend or UI.
 */
function getEnv() {
  const env = {
    RPC_URL: process.env.RPC_URL,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RWA_TOKEN_ADDRESS: process.env.RWA_TOKEN_ADDRESS,
    WHITELIST_ADDRESS: process.env.WHITELIST_ADDRESS,
    FEE_ADDRESS: process.env.FEE_ADDRESS || "",
    ENTRY_FEE_TIMING: Number(process.env.ENTRY_FEE_TIMING || 0),
    EXIT_FEE_TIMING: Number(process.env.EXIT_FEE_TIMING || 1),
  };

  if (!env.RPC_URL || !env.PRIVATE_KEY || !env.RWA_TOKEN_ADDRESS || !env.WHITELIST_ADDRESS) {
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
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);

  const user = await wallet.getAddress();
  const vault = new ethers.Contract(env.RWA_TOKEN_ADDRESS, rwaAbi, wallet);
  const whitelist = new ethers.Contract(env.WHITELIST_ADDRESS, whitelistAbi, wallet);

  const assetAddress = await vault.asset();
  const asset = new ethers.Contract(
    assetAddress,
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)"
    ],
    wallet
  );

  const shareDecimals = await vault.decimals();
  const shareSymbol = await vault.symbol();
  const assetDecimals = await asset.decimals();
  const assetSymbol = await asset.symbol();

  const desiredAssets = ethers.parseUnits(desiredAssetsInput, assetDecimals);
  const shares = ethers.parseUnits(sharesInput, shareDecimals);

  const feeAddress = await resolveFeeAddress(vault, env);
  const feeContract = new ethers.Contract(feeAddress, feeAbi, wallet);

  const [
    whitelisted,
    assetBalance,
    allowance,
    shareBalance,
    maxRedeem,
    entryFee,
    previewDepositShares,
    grossAssets,
    estimatedExitFee,
    previewRedeemNetAssets,
  ] = await Promise.all([
    whitelist.balanceOf(user, 1), // Token ID 1 is the relevant whitelist token
    asset.balanceOf(user),
    asset.allowance(user, env.RWA_TOKEN_ADDRESS),
    vault.balanceOf(user),
    vault.maxRedeem(user),
    feeContract.feeOnRaw(desiredAssets, env.ENTRY_FEE_TIMING),
    // NOTE: previewDeposit expects the total amount that will be sent to deposit()
    vault.previewDeposit(desiredAssets + (await feeContract.feeOnRaw(desiredAssets, env.ENTRY_FEE_TIMING))),
    vault.convertToAssets(shares),
    feeContract.feeOnTotal(await vault.convertToAssets(shares), env.EXIT_FEE_TIMING),
    vault.previewRedeem(shares),
  ]);

  const totalSpend = desiredAssets + entryFee;

  console.log("=== STATUS / DEBUG FLOW ===");
  console.log("User:", user);
  console.log("Whitelisted:", whitelisted);
  console.log("Vault:", env.RWA_TOKEN_ADDRESS);
  console.log("Whitelist:", env.WHITELIST_ADDRESS);
  console.log("Fee contract:", feeAddress);
  console.log("Asset token:", assetSymbol, assetAddress);
  console.log("Share token:", shareSymbol, env.RWA_TOKEN_ADDRESS);
  console.log("");
  console.log("--- Balances ---");
  console.log("Asset balance:", ethers.formatUnits(assetBalance, assetDecimals), assetSymbol);
  console.log("Allowance to vault:", ethers.formatUnits(allowance, assetDecimals), assetSymbol);
  console.log("Share balance:", ethers.formatUnits(shareBalance, shareDecimals), shareSymbol);
  console.log("maxRedeem:", ethers.formatUnits(maxRedeem, shareDecimals), shareSymbol);
  console.log("");
  console.log("--- Deposit preview ---");
  console.log("Desired assets before fee:", desiredAssetsInput, assetSymbol);
  console.log("Entry fee (feeOnRaw):", ethers.formatUnits(entryFee, assetDecimals), assetSymbol);
  console.log("Total spend:", ethers.formatUnits(totalSpend, assetDecimals), assetSymbol);
  console.log("previewDeposit(totalSpend):", ethers.formatUnits(previewDepositShares, shareDecimals), shareSymbol);
  console.log("");
  console.log("--- Redeem preview ---");
  console.log("Input shares:", sharesInput, shareSymbol);
  console.log("convertToAssets(shares) [gross info]:", ethers.formatUnits(grossAssets, assetDecimals), assetSymbol);
  console.log("Estimated exit fee (feeOnTotal):", ethers.formatUnits(estimatedExitFee, assetDecimals), assetSymbol);
  console.log("previewRedeem(shares) [final net]:", ethers.formatUnits(previewRedeemNetAssets, assetDecimals), assetSymbol);
}

main().catch((error) => {
  console.error("Status flow failed:", error.shortMessage || error.message || error);
  process.exit(1);
});
