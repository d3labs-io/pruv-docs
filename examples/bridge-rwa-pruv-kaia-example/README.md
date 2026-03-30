# PRUV Bridge — Cross-Chain Transfer Scripts

Programmatic bridge scripts for transferring tokens between **Kaia Kairos Testnet** and **PRUV Testnet** using the Hyperlane warp route infrastructure.

Two token types are supported:

| Script | Token | Description |
|--------|-------|-------------|
| `scripts-usdt/` | **USDT** | Standard ERC20 stablecoin bridge |
| `scripts-rwa/` | **RWA (KAI)** | Real World Asset token bridge ("KAIA TEST" / KAI) |

---

## Contract Addresses

### USDT Bridge

#### Kaia Kairos Testnet (domain 1001)

| Contract | Address |
|----------|---------|
| Warp Route | `0x8fe41adb2890df3d591160052fb0e502e4f07f11` |
| USDT Token | `0xd077a400968890eacc75cdc901f0356c943e4fdb` |

#### PRUV Testnet (domain 7336)

| Contract | Address |
|----------|---------|
| Warp Route | `0xe0f0a2d91ca9a3db5635048f8b2be4a016bba592` |
| USDT Token | `0xc547f385c7D0A50Bb4b4889dF4d863F0abAD2885` |

### RWA (KAI) Bridge

#### PRUV Testnet (domain 7336)

| Contract | Address | Type |
|----------|---------|------|
| Warp Route | `0x6a7ac9211E92cF0c4481BC606666b30B2d110592` | HypERC20CollateralWithFee (TransparentUpgradeableProxy → `0x4fB21AC01eE3d35cd6bB537F2cB7dB120e0476Bc`) |
| RWA Token | `0x16cE242211458bd215eC7304367520F60B0D09c9` | "KAIA TEST" (KAI), 6 decimals, ERC1967Proxy |
| Fee Token (USDC) | `0xeCacC484026a02022565496E088CA0581cC36373` | FiatTokenProxy (FiatTokenV2_2), 6 decimals |

#### Kaia Kairos Testnet (domain 1001)

| Contract | Address | Type |
|----------|---------|------|
| Warp Route / Token | `0x1daeeb8410741c38ed77fc0d120186bd6b6e0306` | HypERC20 synthetic (warp route IS the token), "KAIA TEST" (KAI), 6 decimals |

#### Router Enrollment

Both warp routes are bidirectionally enrolled:

- PRUV `0x6a7ac...` → `routers(1001)` = `0x1daeeb8410741c38ed77fc0d120186bd6b6e0306` (Kaia)
- Kaia `0x1daee...` → `routers(7336)` = `0x6a7ac9211E92cF0c4481BC606666b30B2d110592` (PRUV)

---

## Bridge Flow

### How It Works

1. **Quote** — calls `quoteTransferRemote` on the warp route to get gas payment, transfer token amount, and fee amount
2. **Validate** — verifies all balances (native, transfer token, fee token)
3. **Approve transfer token** — sets ERC20 allowance for the transfer token to the warp route
4. **Approve fee token** — sets ERC20 allowance for the fee token (if a fee is required)
5. **Call `transferRemote`** — sends tokens through Hyperlane warp route with gas payment as msg.value
6. **Wait for delivery** — polls the destination chain for `ReceivedTransferRemote` event

After the transaction is confirmed on the source chain, the Hyperlane relayer picks up the message and delivers it to the destination chain (typically 1–5 minutes on testnet).

### Direction-Specific Behavior

#### USDT

| | Kaia → PRUV | PRUV → Kaia |
|---|---|---|
| **Fee** | None | 0.1 USDC |
| **Quote length** | 1 (gas only) | 3 (gas + transfer + fee) |

#### RWA (KAI)

| | PRUV → Kaia | Kaia → PRUV |
|---|---|---|
| **Route type** | Collateral (HypERC20CollateralWithFee) | Synthetic (HypERC20) |
| **Quote length** | 3 (gas + transfer + fee) | 1 (gas only) |
| **Fee** | 0.1 USDC | None |
| **Token action** | Lock collateral | Burn synthetic |
| **Delivery action** | Mint synthetic | Release collateral |
| **Approvals needed** | 2 (RWA token + USDC fee) | 1 (synthetic KAI) |

### Fee Collection Flow

The warp route contracts (`HypERC20CollateralWithFee` / `HypFiatTokenWithFee`) collect a fee during `transferRemote`:

```
quoteTransferRemote() → [gasPayment, transferAmount, feeAmount]
                                                          │
transferRemote() internally does:                         │
  1. feeCollector.quoteFee(destination)  ←────────────────┘
  2. safeTransferFrom(sender → feeCollector, feeAmount)   ← needs approval
  3. _transferRemote(destination, recipient, amount)       ← needs approval
```

The fee token (e.g., USDC) may be **different** from the transfer token (e.g., USDT or KAI). The scripts handle both approvals automatically.

---

## Setup

```bash
# USDT bridge
cd scripts/scripts-usdt
yarn install
cp .env.example .env

# RWA bridge
cd scripts/scripts-rwa
yarn install
cp .env.example .env

# Edit .env with your private key and desired parameters
```

---

## Usage

### USDT Bridge

```bash
cd scripts/scripts-usdt

# Bridge 1 USDT from Kaia → Pruv (default direction)
yarn bridge --private-key <YOUR_KEY> --token-amount 1

# Bridge from Pruv → Kaia
yarn bridge --source-chain pruv --destination-chain kaia \
  --private-key <YOUR_KEY> \
  --token-amount 1

# Shortcut scripts
yarn bridge:kaia-to-pruv
yarn bridge:pruv-to-kaia
```

### RWA (KAI) Bridge

```bash
cd scripts/scripts-rwa

# Bridge RWA from PRUV to Kaia (using .env defaults)
yarn bridge:pruv-to-kaia

# Bridge RWA from Kaia to PRUV
yarn bridge:kaia-to-pruv

# Custom parameters (CLI flags override .env)
yarn bridge --source-chain pruv --destination-chain kaia --token-amount 1 --private-key 0x...

# Send to a different recipient
yarn bridge --source-chain pruv --destination-chain kaia --token-amount 1 --recipient 0x...
```

---

## CLI Options

| Flag | Env Variable | Description | Default |
|------|-------------|-------------|---------|
| `--private-key` | `PRIVATE_KEY` | Sender wallet private key | (required) |
| `--token-amount` | `TOKEN_AMOUNT` | Amount in human-readable format (e.g., `1` = 1 token) | (required) |
| `--source-chain` | `SOURCE_CHAIN` | Source chain: `kaia` or `pruv` | `kaia` |
| `--destination-chain` | `DESTINATION_CHAIN` | Destination chain: `kaia` or `pruv` | `pruv` |
| `--recipient` | `RECIPIENT` | Override recipient address | sender address |

> **Priority**: CLI arguments override `.env` values.
>
> **Token address** is determined automatically from the source chain — no need to specify it.

---

## Example Output

### Kaia → Pruv (USDT, no fee)

```
────────────────────────────────────────────────────────────
  PRUV Bridge — Transfer Remote
────────────────────────────────────────────────────────────
  Source:      Kaia Kairos Testnet (domain 1001)
  Destination: Pruv Testnet (domain 7336)
  Token:       0xd077a400968890eacc75cdc901f0356c943e4fdb
  Amount:      0.4
────────────────────────────────────────────────────────────

  Sender:      0x3AA0...Bfb3
  Recipient:   0x3AA0...Bfb3
  Raw amount:  400000 (6 decimals)

  Step 1: Quoting transfer...
  Gas quote:       0.0 native token
  Transfer token:  0xd077...4fDb (USDT)
  Transfer amount: 0.4 USDT
  Fee:             None

  Pre-flight checks...
  Native balance:  1.2
  USDT balance:    5.0
  All checks passed
────────────────────────────────────────────────────────────

  Step 2: Approving transfer token...
  Approve tx:  https://kairos.kaiascan.io/tx/0xf686...42cd
  USDT approval confirmed

  Step 3: No fee token approval needed

  Step 4: Calling transferRemote...
  Tx hash:  0xd1ef...42e2
  Explorer: https://kairos.kaiascan.io/tx/0xd1ef...42e2
────────────────────────────────────────────────────────────

  Transfer submitted successfully!
  Block:       211586230
  Gas used:    152973
  Status:      Success
────────────────────────────────────────────────────────────

  Summary:
  Bridged 0.4 USDT from Kaia Kairos Testnet → Pruv Testnet
  Recipient: 0x3AA0...Bfb3

  Step 5: Waiting for delivery on Pruv Testnet...
  Delivered in block 11277083
  Tx:  https://explorer.testnet.pruv.network/tx/0xbfed...8c38
  Amount received: 0.4 USDT
```

### Pruv → Kaia (USDT, with USDC fee)

```
────────────────────────────────────────────────────────────
  PRUV Bridge — Transfer Remote
────────────────────────────────────────────────────────────
  Source:      Pruv Testnet (domain 7336)
  Destination: Kaia Kairos Testnet (domain 1001)
  Token:       0xc547f385c7D0A50Bb4b4889dF4d863F0abAD2885
  Amount:      0.5
────────────────────────────────────────────────────────────

  Sender:      0x3AA0...Bfb3
  Recipient:   0x3AA0...Bfb3
  Raw amount:  500000 (6 decimals)

  Step 1: Quoting transfer...
  Gas quote:       0.0 native token
  Transfer token:  0xc547...2885 (USDT)
  Transfer amount: 0.5 USDT
  Fee token:       0xeCac...6373 (USDC)
  Fee amount:      0.1 USDC

  Pre-flight checks...
  Native balance:  2.0
  USDT balance:    3.5
  USDC balance:    1.0 (fee token)
  All checks passed
────────────────────────────────────────────────────────────

  Step 2: Approving transfer token...
  Approve tx:  https://explorer.testnet.pruv.network/tx/0xfcd6...cedd
  USDT approval confirmed

  Step 3: Approving fee token (USDC)...
  Approve tx:  https://explorer.testnet.pruv.network/tx/0xd220...4e8f
  USDC (fee) approval confirmed

  Step 4: Calling transferRemote...
  Tx hash:  0x1cbe...3b06
  Explorer: https://explorer.testnet.pruv.network/tx/0x1cbe...3b06
────────────────────────────────────────────────────────────

  Transfer submitted successfully!
  Block:       11277093
  Gas used:    165455
  Status:      Success
────────────────────────────────────────────────────────────

  Summary:
  Bridged 0.5 USDT from Pruv Testnet → Kaia Kairos Testnet
  Fee paid: 0.1 USDC
  Recipient: 0x3AA0...Bfb3

  Step 5: Waiting for delivery on Kaia Kairos Testnet...
  Delivered in block 211586288
  Tx:  https://kairos.kaiascan.io/tx/0x3d42...41e1
  Amount received: 0.5 USDT
```

---

## Test Results (RWA Bridge)

All tests run on 2026-03-13 with sender `0x3AA0dDE27a8626072253219081AE388AEF43Bfb3`.

### Test 1: PRUV → Kaia (1.5 KAI)

| Step | Tx Hash | Explorer |
|------|---------|----------|
| Approve KAI | `0xb2d92e6a...` | [PRUV](https://explorer.testnet.pruv.network/tx/0xb2d92e6a3720c1fa187044864e923995830a90c3c6a847fc5bc543531f945809) |
| Approve USDC (fee) | `0x49e36540...` | [PRUV](https://explorer.testnet.pruv.network/tx/0x49e3654018305193d725298823914da05a1dcb6ddffe065635711f700d1f1002) |
| transferRemote | `0x62378eae...` | [PRUV](https://explorer.testnet.pruv.network/tx/0x62378eaec375b26b4ac94b1d1627df41ab9291e441dfb47d4f4964140705bfdb) |
| Delivery | `0x4c10ee8c...` | [Kaia](https://kairos.kaiascan.io/tx/0x4c10ee8cdc2e407e0b49c14f4c0c262c79583706ffcf76aa22d5ba0570310fe7) |

- **Amount**: 1.5 KAI (raw: 1,500,000) | **Fee**: 0.1 USDC | **Gas used**: 180,109 | **Status**: Delivered

### Test 2: Kaia → PRUV (1.3 KAI)

| Step | Tx Hash | Explorer |
|------|---------|----------|
| Approve KAI (synthetic) | `0xd0fa23ca...` | [Kaia](https://kairos.kaiascan.io/tx/0xd0fa23ca6742a6934dfdfe10cb9d7cb6c5c611d5c4e92c933be4cee95cd43708) |
| transferRemote | `0x05bccce5...` | [Kaia](https://kairos.kaiascan.io/tx/0x05bccce51569f77379b4b46cf52f09f7c77f9532159bc6987ee275a035124871) |
| Delivery | `0x1ccbc1ac...` | [PRUV](https://explorer.testnet.pruv.network/tx/0x1ccbc1ace8a80082c83661e86583747c1564f423f91ea228c801510319e665e4) |

- **Amount**: 1.3 KAI (raw: 1,300,000) | **Fee**: None | **Gas used**: 136,474 | **Status**: Delivered

### Reference Transactions (Manual PRUV → Kaia)

| Step | Tx Hash | Description |
|------|---------|-------------|
| Approve USDC (fee) | [`0x7fe34fee...`](https://explorer.testnet.pruv.network/tx/0x7fe34fee81549624052ecbb32b685b4d112c1ed2eb72bb1a1a7cea0fa2bb608a) | Approved 100,000 USDC (0.1 USDC) to warp route |
| Approve RWA token | [`0x50ca867a...`](https://explorer.testnet.pruv.network/tx/0x50ca867ab5d316868e7eaebad2ff23aaa37c311fabdebbc5b4758d2577d9a3d2) | Approved 1,000,000 KAI (1 KAI) to warp route |
| Bridge (transferRemote) | [`0x878bbc12...`](https://explorer.testnet.pruv.network/tx/0x878bbc12b9dbbac16ef05a9a2f055f1e4a3232d4d2ce65d8dce7759c129adf84) | Bridged 1 KAI from PRUV → Kaia (domain 1001) |

#### Bridge Transaction Decoded

- **Method**: `transferRemote(uint32 _destination, bytes32 _recipient, uint256 _amountOrId)`
- **Parameters**:
  - `_destination`: `1001` (Kaia Kairos)
  - `_recipient`: `0x0000000000000000000000003aa0dde27a8626072253219081ae388aef43bfb3`
  - `_amountOrId`: `1000000` (1 KAI with 6 decimals)
- **Token transfers in tx**:
  - USDC: 100,000 (0.1 USDC fee) → RouterFeeCollector
  - KAI: 1,000,000 (1 KAI) → Warp Route (locked as collateral)
- **Gas used**: 180,109

---

## Output

Each bridge execution appends a detailed markdown log to `output.md` (within each script directory) with full tx hashes, parameters, quote breakdown, and relay status.

---

## Project Structure

```
scripts/
├── README.md                 # This file
├── scripts-usdt/             # USDT bridge scripts
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   ├── tsconfig.json
│   ├── output.md             # Auto-generated execution logs
│   └── src/
│       ├── args.ts           # CLI argument parser
│       ├── config.ts         # Chain configs, contract addresses, ABIs
│       ├── flow-logger.ts    # Appends structured logs to output.md
│       ├── helpers.ts        # addressToBytes32, getTokenInfo, ensureAllowance
│       ├── main.ts           # Bridge orchestration (quote → approve → transfer → relay)
│       ├── relay-listener.ts # Polls destination chain for ReceivedTransferRemote event
│       └── types.ts          # TypeScript interfaces
└── scripts-rwa/              # RWA (KAI) bridge scripts
    ├── .env.example
    ├── .gitignore
    ├── package.json
    ├── tsconfig.json
    ├── output.md             # Auto-generated execution logs
    ├── README.md
    └── src/
        ├── args.ts           # CLI argument parser
        ├── config.ts         # Chain configs, contract addresses, ABIs
        ├── flow-logger.ts    # Appends structured logs to output.md
        ├── helpers.ts        # addressToBytes32, getTokenInfo, ensureAllowance
        ├── main.ts           # Bridge orchestration (quote → approve → transfer → relay)
        ├── relay-listener.ts # Polls destination chain for ReceivedTransferRemote event
        └── types.ts          # TypeScript interfaces
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Insufficient balance` | Not enough transfer tokens | Fund wallet with tokens on source chain |
| `Insufficient fee balance` | Not enough fee tokens (e.g., USDC) | Fund wallet with fee tokens on source chain |
| `Failed to quote transfer` | Warp route not configured for destination | Verify chain domain IDs and warp route address |
| `Transaction reverted` | Insufficient approval, contract paused, etc. | Check approvals, native balance, contract state |
| `PRIVATE_KEY missing` | Neither CLI arg nor .env provided | Pass `--private-key` or set in `.env` |

---

## Technical Notes

- **Token decimals**: Both KAI, USDT, and USDC use 6 decimals. `1 token` = `1,000,000` raw units.
- **Gas payment**: Currently `0` for both directions (testnet configuration).
- **Relay time**: Typically 1–10 seconds on testnet (5–10 for RWA, 1–5 for USDT).
- **Fee**: 0.1 USDC flat fee on fee-collecting directions only (enforced by RouterFeeCollector on the collateral route).
- **Quote format differs by route type**: Collateral routes return 3 quotes (gas, transfer, fee). Synthetic routes return only 1 quote (gas). Both scripts handle this gracefully.

---

## Security

- **Never commit `.env` files** — they contain your private key
- `.env` is gitignored; use `.env.example` as template
- For production, use a dedicated bridge wallet with limited funds
- Consider using hardware wallet signing for mainnet operations
