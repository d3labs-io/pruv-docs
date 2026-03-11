# RWA Client Contract Interaction Example (With Fee v2)

This package contains standalone **Node.js + ethers** examples for:

- **deposit**: perform asset deposits with entry-fee handling and preview the expected shares before execution.
- **redeem**: redeem shares into assets with exit-fee handling and preview the final net assets received.
- **price / info**: fetch contract information, pricing/conversion data, and deposit/redeem estimates for display or validation.
- **status**: check balances, allowances, and contract/user readiness before executing transactions.

It also supports:

- whitelist checks
- fee contract reads
- explicit `FEE_ADDRESS` from env
- fallback to `vault.rwaFee()` if `FEE_ADDRESS` is not provided
- Hardhat artifact imports using `.abi`
- inline code documentation for easier client integration

## Fee rules implemented

### Deposit
User input is interpreted as **desired assets before entry fee**.

The script calculates:

- `entryFee = feeOnRaw(desiredAssets, ENTRY_FEE_TIMING)`
- `totalSpend = desiredAssets + entryFee`

Then it calls:

```js
deposit(totalSpend, receiver)
```

And uses:

```js
previewDeposit(totalSpend)
```

### Redeem
`previewRedeem(shares)` is treated as the **final net amount** already.

For information only, the script also shows:

- `grossAssets = convertToAssets(shares)`
- `estimatedExitFee = feeOnTotal(grossAssets, EXIT_FEE_TIMING)`

But the script **does not subtract the fee again** from `previewRedeem`.

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
WHITELIST_ADDRESS=0xyour_whitelist_address
FEE_ADDRESS=0xyour_rwa_fee_address
APPROVE_MAX=false
ENTRY_FEE_TIMING=0
EXIT_FEE_TIMING=1
```

## Run

```bash
npm run deposit -- 100
npm run redeem -- 25
npm run price -- 100 25
npm run status -- 100 25
```

Or:

```bash
npm start -- deposit 100
npm start -- redeem 25
npm start -- price 100 25
npm start -- status 100 25
```

## Meaning of inputs

- `deposit 100`
  - `100` means desired assets before entry fee
  - actual `deposit()` call uses `100 + entryFee`
- `redeem 25`
  - `25` means input shares to redeem
- `price 100 25`
  - first number = deposit info input
  - second number = redeem info input
- `status 100 25`
  - first number = deposit preview input
  - second number = redeem preview input
