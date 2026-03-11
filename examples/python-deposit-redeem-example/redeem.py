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
        "EXIT_FEE_TIMING": int(os.getenv("EXIT_FEE_TIMING") or 1),
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
        raise ValueError("Usage: python redeem.py <shares>")

    shares_input = sys.argv[2]
    env = get_env()

    w3 = Web3(Web3.HTTPProvider(env["RPC_URL"]))
    account = w3.eth.account.from_key(env["PRIVATE_KEY"])
    user = account.address

    rwa_abi = load_abi("RWAToken.json")
    whitelist_abi = load_abi("Whitelist.json")
    fee_abi = load_abi("RWAFee.json")

    vault = w3.eth.contract(address=env["RWA_TOKEN_ADDRESS"], abi=rwa_abi)
    whitelist = w3.eth.contract(address=env["WHITELIST_ADDRESS"], abi=whitelist_abi)

    print("=== REDEEM FLOW (WITH EXIT FEE INFO) ===")
    print("User:", user)
    print("Vault:", env["RWA_TOKEN_ADDRESS"])
    print("Whitelist:", env["WHITELIST_ADDRESS"])

    is_whitelisted = whitelist.functions.balanceOf(user, 1).call()
    print("Whitelisted:", is_whitelisted)
    if not is_whitelisted:
        raise ValueError("User is not whitelisted.")

    share_decimals = vault.functions.decimals().call()
    share_symbol = vault.functions.symbol().call()
    shares = int(float(shares_input) * (10**share_decimals))

    share_balance = vault.functions.balanceOf(user).call()
    max_redeem = vault.functions.maxRedeem(user).call()

    print("Requested shares:", shares_input, share_symbol)
    print("Wallet share balance:", share_balance / (10**share_decimals), share_symbol)
    print("maxRedeem:", max_redeem / (10**share_decimals), share_symbol)

    if share_balance < shares:
        raise ValueError("Not enough share balance.")

    if max_redeem < shares:
        raise ValueError("Requested shares exceed maxRedeem.")

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
        ],
    )

    asset_decimals = asset.functions.decimals().call()
    asset_symbol = asset.functions.symbol().call()

    fee_address = resolve_fee_address(vault, env)
    fee_contract = w3.eth.contract(address=fee_address, abi=fee_abi)

    gross_assets = vault.functions.convertToAssets(shares).call()
    estimated_exit_fee = fee_contract.functions.feeOnTotal(
        gross_assets, env["EXIT_FEE_TIMING"]
    ).call()
    net_assets_from_preview = vault.functions.previewRedeem(shares).call()

    print("Fee contract:", fee_address)
    print(
        "convertToAssets(shares) [gross info]:",
        gross_assets / (10**asset_decimals),
        asset_symbol,
    )
    print(
        "feeOnTotal(grossAssets, EXIT) [info only]:",
        estimated_exit_fee / (10**asset_decimals),
        asset_symbol,
    )
    print(
        "previewRedeem(shares) [final net]:",
        net_assets_from_preview / (10**asset_decimals),
        asset_symbol,
    )

    print("Sending redeem(shares, receiver, owner)...")
    nonce = w3.eth.get_transaction_count(user)
    redeem_tx = vault.functions.redeem(shares, user, user).build_transaction(
        {"from": user, "nonce": nonce, "gas": 200000, "gasPrice": w3.eth.gas_price}
    )
    signed_redeem_tx = w3.eth.account.sign_transaction(redeem_tx, env["PRIVATE_KEY"])
    redeem_tx_hash = w3.eth.send_raw_transaction(signed_redeem_tx.raw_transaction)
    print("Redeem tx:", w3.to_hex(redeem_tx_hash))
    receipt = w3.eth.wait_for_transaction_receipt(redeem_tx_hash)
    print("Redeem confirmed in block:", receipt["blockNumber"])


if __name__ == "__main__":
    main()
