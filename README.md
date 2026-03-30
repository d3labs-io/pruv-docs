# PRUV Network — Documentation & Examples

Documentation and implementation examples for the RWA (Real World Asset) protocol and cross-chain bridge on the PRUV network.

## Examples

### RWA Deposit & Redeem

Interact with the RWA vault contract — deposit assets, redeem shares, query pricing, and check balances/allowances.

| Language | Stack | Description |
|----------|-------|-------------|
| [Node.js](./examples/node-js-deposit-redeem-example/) | ethers.js | Deposit, redeem, price info, status checks |
| [Python](./examples/python-deposit-redeem-example/) | web3.py | Deposit, redeem, price info, status checks |

### Cross-Chain Bridge

Transfer tokens between **PRUV Testnet** and **Kaia Kairos Testnet** via Hyperlane warp routes.

| Example | Tokens | Description |
|---------|--------|-------------|
| [Bridge (PRUV ↔ Kaia)](./examples/bridge-rwa-pruv-kaia-example/) | USDT, RWA (KAI) | Cross-chain bridge with fee handling and relay tracking |

## Quick Start

```bash
# Clone the repo
git clone <repo-url> && cd pruv-docs

# Pick an example
cd examples/node-js-deposit-redeem-example   # or python / bridge
cp .env.example .env                         # configure your keys
```

See each example's README for detailed setup and usage instructions.

## License

MIT
