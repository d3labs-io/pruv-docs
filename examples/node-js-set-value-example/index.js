require("dotenv").config();

/**
 * Simple dispatcher so users can run one entry point:
 *   npm start -- value [newValue] [rwaTokenAddress]
 */
const flow = process.argv[2];
const args = process.argv.slice(3);

if (!flow || flow !== "value") {
  console.log("Usage:");
  console.log("  npm start -- value [newValue] [rwaTokenAddress]");
  process.exit(1);
}

process.argv = ["node", `value.js`, ...args];
require(`./value.js`);
