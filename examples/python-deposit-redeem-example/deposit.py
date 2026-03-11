import os
import sys
import json
from dotenv import load_dotenv
from web3 import Web3

load_dotenv()


def get_env():
    rwa_token = os.getenv("RWA_TOKEN_ADDRESS")
    whitelist = os.getenv("WHITELIST_ADDRESS")
    fee_address = os.getenv("FEE_ADDRESS") or ""

    env = {
        "RPC_URL": os.getenv("RPC_URL"),
        "PRIVATE_KEY": os.getenv("PRIVATE_KEY"),
        "RWA_TOKEN_ADDRESS": Web3.to_checksum_address(rwa_token) if rwa_token else "",
        "WHITELIST_ADDRESS": Web3.to_checksum_address(whitelist) if whitelist else "",
        "FEE_ADDRESS": Web3.to_checksum_address(fee_address) if fee_address else "",
        "APPROVE_MAX": os.getenv("APPROVE_MAX", "false").lower() == "true",
        "ENTRY_FEE_TIMING": int(os.getenv("ENTRY_FEE_TIMING") or 0),
    }

    if not all(
        [
            env["RPC_URL"],
            env["PRIVATE_KEY"],
            env["RWA_TOKEN_ADDRESS"],
            env["WHITELIST_ADDRESS"],
        ]
    ):
        raise ValueError("Missing required env values. Please check .env.example")

    return env


def load_abi(filename):
    path = os.path.join(os.path.dirname(__file__), "abis", filename)
    with open(path, "r") as f:
        data = json.load(f)
        return data.get("abi", data)


def resolve_fee_address(vault, env):
    if env["FEE_ADDRESS"]:
        return env["FEE_ADDRESS"]

    fee_address = vault.functions.rwaFee().call()
    if not fee_address or fee_address == "0x0000000000000000000000000000000000000000":
        raise ValueError(
            "Fee address is not configured. Set FEE_ADDRESS or ensure vault.rwaFee() returns a valid address."
        )

    return fee_address


def main():
    if len(sys.argv) < 3:
        raise ValueError("Usage: python deposit.py <desiredAssetsBeforeFee>")

    desired_assets_input = sys.argv[2]
    env = get_env()

    w3 = Web3(Web3.HTTPProvider(env["RPC_URL"]))
    account = w3.eth.account.from_key(env["PRIVATE_KEY"])
    user = account.address

    rwa_abi = load_abi("RWAToken.json")
    whitelist_abi = load_abi("Whitelist.json")
    fee_abi = load_abi("RWAFee.json")

    vault = w3.eth.contract(address=env["RWA_TOKEN_ADDRESS"], abi=rwa_abi)
    whitelist = w3.eth.contract(address=env["WHITELIST_ADDRESS"], abi=whitelist_abi)

    print("=== DEPOSIT FLOW (WITH ENTRY FEE) ===")
    print("User:", user)
    print("Vault:", env["RWA_TOKEN_ADDRESS"])
    print("Whitelist:", env["WHITELIST_ADDRESS"])

    is_whitelisted = whitelist.functions.balanceOf(user, 1).call()
    print("Whitelisted:", is_whitelisted)
    if not is_whitelisted:
        raise ValueError("User is not whitelisted.")

    asset_address = vault.functions.asset().call()

    asset = w3.eth.contract(
        address=asset_address,
        abi=[
            {
                "inputs": [],
                "name": "decimals",
                "outputs": [{"type": "uint8"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [],
                "name": "symbol",
                "outputs": [{"type": "string"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [{"type": "address"}],
                "name": "balanceOf",
                "outputs": [{"type": "uint256"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [{"type": "address"}, {"type": "address"}],
                "name": "allowance",
                "outputs": [{"type": "uint256"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [{"type": "address"}, {"type": "uint256"}],
                "name": "approve",
                "outputs": [{"type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function",
            },
        ],
    )

    asset_decimals = asset.functions.decimals().call()
    asset_symbol = asset.functions.symbol().call()
    desired_assets = int(float(desired_assets_input) * (10**asset_decimals))

    fee_address = resolve_fee_address(vault, env)
    fee_contract = w3.eth.contract(address=fee_address, abi=fee_abi)

    entry_fee = fee_contract.functions.feeOnRaw(
        desired_assets, env["ENTRY_FEE_TIMING"]
    ).call()
    total_spend = desired_assets + entry_fee
    preview_shares = vault.functions.previewDeposit(total_spend).call()

    share_decimals = vault.functions.decimals().call()
    share_symbol = vault.functions.symbol().call()

    print("Fee contract:", fee_address)
    print("Desired assets before fee:", desired_assets_input, asset_symbol)
    print("Entry fee:", entry_fee / (10**asset_decimals), asset_symbol)
    print(
        "Total spend sent to deposit():",
        total_spend / (10**asset_decimals),
        asset_symbol,
    )
    print(
        "previewDeposit(totalSpend):",
        preview_shares / (10**share_decimals),
        share_symbol,
    )

    asset_balance = asset.functions.balanceOf(user).call()
    allowance = asset.functions.allowance(user, env["RWA_TOKEN_ADDRESS"]).call()

    print("Wallet asset balance:", asset_balance / (10**asset_decimals), asset_symbol)
    print("Allowance to vault:", allowance / (10**asset_decimals), asset_symbol)

    if asset_balance < total_spend:
        raise ValueError("Not enough asset balance for desiredAssets + entryFee.")

    if allowance < total_spend:
        approve_amount = 2**256 - 1 if env["APPROVE_MAX"] else total_spend
        print("Allowance is not enough, sending approve()...")
        nonce = w3.eth.get_transaction_count(user)
        approve_tx = asset.functions.approve(
            env["RWA_TOKEN_ADDRESS"], approve_amount
        ).build_transaction(
            {"from": user, "nonce": nonce, "gas": 100000, "gasPrice": w3.eth.gas_price}
        )
        signed_approve_tx = w3.eth.account.sign_transaction(
            approve_tx, env["PRIVATE_KEY"]
        )
        approve_tx_hash = w3.eth.send_raw_transaction(signed_approve_tx.raw_transaction)
        print("Approve tx:", w3.to_hex(approve_tx_hash))
        w3.eth.wait_for_transaction_receipt(approve_tx_hash)
        print("Approve confirmed.")
    else:
        print("Allowance is already enough.")

    print("Sending deposit(totalSpend, receiver)...")
    nonce = w3.eth.get_transaction_count(user)
    deposit_tx = vault.functions.deposit(total_spend, user).build_transaction(
        {"from": user, "nonce": nonce, "gas": 200000, "gasPrice": w3.eth.gas_price}
    )
    signed_deposit_tx = w3.eth.account.sign_transaction(deposit_tx, env["PRIVATE_KEY"])
    deposit_tx_hash = w3.eth.send_raw_transaction(signed_deposit_tx.raw_transaction)
    print("Deposit tx:", w3.to_hex(deposit_tx_hash))
    receipt = w3.eth.wait_for_transaction_receipt(deposit_tx_hash)
    print("Deposit confirmed in block:", receipt["blockNumber"])


if __name__ == "__main__":
    main()
