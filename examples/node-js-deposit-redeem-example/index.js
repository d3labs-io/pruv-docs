require("dotenv").config();

/**
 * Simple dispatcher so users can run one entry point:
 *   npm start -- deposit 100
 *   npm start -- redeem 25
 *   npm start -- price 100 25
 *   npm start -- status 100 25
 */
const flow = process.argv[2];
const args = process.argv.slice(3);

if (!flow) {
  console.log("Usage:");
  console.log("  npm start -- deposit <desiredAssetsBeforeFee>");
  console.log("  npm start -- redeem <shares>");
  console.log("  npm start -- price [desiredAssetsBeforeFee] [shares]");
  console.log("  npm start -- status [desiredAssetsBeforeFee] [shares]");
  process.exit(1);
}

const supported = new Set(["deposit", "redeem", "price", "status"]);
if (!supported.has(flow)) {
  console.error(`Unsupported flow: ${flow}`);
  process.exit(1);
}

process.argv = ["node", `${flow}.js`, ...args];
require(`./${flow}.js`);
