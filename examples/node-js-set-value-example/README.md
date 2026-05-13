# RWA Set Value Interaction Example

This package contains standalone **Node.js + ethers** examples for interacting with the **RWAConversion** contract:

- **read value**: fetch the current conversion value from the contract.
- **set value**: update the conversion value (requires `PRIVATE_KEY`).

## Features
- Automatically fetches the `RWAConversion` address from a given `RWAToken`.
- Handles 18-decimal precision for the conversion value.
- Supports command-line overrides for the `RWAToken` address.

## Install

```bash
npm install
cp .env.example .env
```

## Environment variables

```env
RPC_URL=https://your-rpc-url
PRIVATE_KEY=0xyourprivatekey
RWA_TOKEN_ADDRESS=0xyour_rwa_token_address
```

## Run

### Check current value
```bash
npm run value
```

### Set new value (e.g., 1.5)
```bash
npm run value -- 1.5
```

### Set value for a specific RWAToken
```bash
npm run value -- 1.5 0x123...
```

Or using the dispatcher:

```bash
npm start -- value 1.5
```
