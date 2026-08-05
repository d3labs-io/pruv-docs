require("dotenv").config();
const { ethers } = require("ethers");

/**
 * IMPORTANT:
 * We intentionally access `.abi` from the JSON files because these files are
 * Hardhat-style artifacts, not plain ABI arrays.
 */
const rwaAbi = require("./abis/RWAToken.json").abi;
const conversionAbi = require("./abis/RWAConversion.json").abi;

/**
 * Load and validate environment variables.
 */
function getEnv() {
  const env = {
    RPC_URL: process.env.RPC_URL,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RWA_TOKEN_ADDRESS: process.env.RWA_TOKEN_ADDRESS,
  };

  if (!env.RPC_URL || !env.RWA_TOKEN_ADDRESS) {
    throw new Error("Missing required env values (RPC_URL, RWA_TOKEN_ADDRESS). Please check .env.example");
  }

  return env;
}

/**
 * Main RWAConversion interaction flow.
 *
 * Usage:
 *   node value.js [newValue] [rwaTokenAddress]
 *
 * Examples:
 *   node value.js          (Read current value)
 *   node value.js 1.5      (Set value to 1.5 with 18 decimals)
 *   node value.js 1.5 0x... (Set value for specific RWAToken)
 */
async function main() {
  const newValueInput = process.argv[2];
  const rwaTokenOverride = process.argv[3];

  const env = getEnv();
  const rwaTokenAddress = rwaTokenOverride || env.RWA_TOKEN_ADDRESS;

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  
  // Use wallet if private key is available, otherwise read-only provider
  let signerOrProvider = provider;
  if (env.PRIVATE_KEY) {
    signerOrProvider = new ethers.Wallet(env.PRIVATE_KEY, provider);
  }

  const vault = new ethers.Contract(rwaTokenAddress, rwaAbi, signerOrProvider);

  console.log("=== RWA CONVERSION INTERACTION ===");
  console.log("RWAToken:", rwaTokenAddress);

  // 1) Get RWAConversion address from RWAToken
  const conversionAddress = await vault.rwaConversion();
  console.log("RWAConversion address:", conversionAddress);

  if (!conversionAddress || conversionAddress === ethers.ZeroAddress) {
    throw new Error("RWAConversion address is zero or not set in the RWAToken contract.");
  }

  const conversion = new ethers.Contract(conversionAddress, conversionAbi, signerOrProvider);

  // 2) Check current value
  const currentValue = await conversion.value();
  console.log("Current value:", ethers.formatUnits(currentValue, 18));

  // 3) Set new value if provided
  if (newValueInput) {
    if (!env.PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY environment variable is required to call setValue().");
    }

    const newValue = ethers.parseUnits(newValueInput, 18);
    console.log(`Sending new value ${newValueInput}`);
    
    const tx = await conversion.setValue(newValue);
    console.log("Transaction sent:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);

    // Verify update
    const updatedValue = await conversion.value();
    console.log("New current value:", ethers.formatUnits(updatedValue, 18));
  }
}

main().catch((error) => {
  console.error("Value interaction failed:", error.shortMessage || error.message || error);
  process.exit(1);
});
