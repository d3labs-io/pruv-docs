require("dotenv").config();
const { ethers } = require("ethers");

const rwaAbi = require("./abis/RWAToken.json").abi;
const whitelistAbi = require("./abis/Whitelist.json").abi;
const feeAbi = require("./abis/RWAFee.json").abi;

/**
 * Load environment variables used by redeem flow.
 */
function getEnv() {
  const env = {
    RPC_URL: process.env.RPC_URL,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RWA_TOKEN_ADDRESS: process.env.RWA_TOKEN_ADDRESS,
    WHITELIST_ADDRESS: process.env.WHITELIST_ADDRESS,
    FEE_ADDRESS: process.env.FEE_ADDRESS || "",
    EXIT_FEE_TIMING: Number(process.env.EXIT_FEE_TIMING || 1),
  };

  if (!env.RPC_URL || !env.PRIVATE_KEY || !env.RWA_TOKEN_ADDRESS || !env.WHITELIST_ADDRESS) {
    throw new Error("Missing required env values. Please check .env.example");
  }

  return env;
}

/**
 * Resolve fee address from env first, then fallback to vault.rwaFee().
 */
async function resolveFeeAddress(vault, env) {
  if (env.FEE_ADDRESS) return env.FEE_ADDRESS;

  const feeAddress = await vault.rwaFee();
  if (!feeAddress || feeAddress === ethers.ZeroAddress) {
    throw new Error("Fee address is not configured. Set FEE_ADDRESS or ensure vault.rwaFee() returns a valid address.");
  }

  return feeAddress;
}

/**
 * Main redeem flow.
 *
 * IMPORTANT FEE RULE:
 * - previewRedeem(shares) already represents the final NET assets returned to user
 * - exit fee information is only shown for transparency
 * - the exit fee info is calculated with feeOnTotal(grossAssets, EXIT)
 * - we do NOT subtract the fee from previewRedeem again
 */
async function main() {
  const sharesInput = process.argv[2];
  if (!sharesInput) {
    throw new Error("Usage: node redeem.js <shares>");
  }

  const env = getEnv();

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(env.RWA_TOKEN_ADDRESS, rwaAbi, wallet);
  const whitelist = new ethers.Contract(env.WHITELIST_ADDRESS, whitelistAbi, wallet);

  const user = await wallet.getAddress();

  console.log("=== REDEEM FLOW (WITH EXIT FEE INFO) ===");
  console.log("User:", user);
  console.log("Vault:", env.RWA_TOKEN_ADDRESS);
  console.log("Whitelist:", env.WHITELIST_ADDRESS);

  // 1) Check whitelist
  const isWhitelisted = await whitelist.balanceOf(user, 1); // Token ID 1 is the relevant whitelist token
  console.log("Whitelisted:", isWhitelisted);
  if (!isWhitelisted) {
    throw new Error("User is not whitelisted.");
  }

  // 2) Parse share input
  const shareDecimals = await vault.decimals();
  const shareSymbol = await vault.symbol();
  const shares = ethers.parseUnits(sharesInput, shareDecimals);

  // 3) Read balance and maxRedeem
  const shareBalance = await vault.balanceOf(user);
  const maxRedeem = await vault.maxRedeem(user);

  console.log("Requested shares:", sharesInput, shareSymbol);
  console.log("Wallet share balance:", ethers.formatUnits(shareBalance, shareDecimals), shareSymbol);
  console.log("maxRedeem:", ethers.formatUnits(maxRedeem, shareDecimals), shareSymbol);

  if (shareBalance < shares) {
    throw new Error("Not enough share balance.");
  }

  if (maxRedeem < shares) {
    throw new Error("Requested shares exceed maxRedeem.");
  }

  // 4) Read asset info
  const assetAddress = await vault.asset();
  const asset = new ethers.Contract(
    assetAddress,
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)"
    ],
    wallet
  );

  const assetDecimals = await asset.decimals();
  const assetSymbol = await asset.symbol();

  // 5) Fee info for transparency only
  const feeAddress = await resolveFeeAddress(vault, env);
  const feeContract = new ethers.Contract(feeAddress, feeAbi, wallet);

  const grossAssets = await vault.convertToAssets(shares);
  const estimatedExitFee = await feeContract.feeOnTotal(grossAssets, env.EXIT_FEE_TIMING);
  const netAssetsFromPreview = await vault.previewRedeem(shares);

  console.log("Fee contract:", feeAddress);
  console.log("convertToAssets(shares) [gross info]:", ethers.formatUnits(grossAssets, assetDecimals), assetSymbol);
  console.log("feeOnTotal(grossAssets, EXIT) [info only]:", ethers.formatUnits(estimatedExitFee, assetDecimals), assetSymbol);
  console.log("previewRedeem(shares) [final net]:", ethers.formatUnits(netAssetsFromPreview, assetDecimals), assetSymbol);

  // 6) Redeem. The contract preview already accounts for final net outcome.
  console.log("Sending redeem(shares, receiver, owner)...");
  const tx = await vault.redeem(shares, user, user);
  console.log("Redeem tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Redeem confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error("Redeem flow failed:", error.shortMessage || error.message || error);
  process.exit(1);
});
