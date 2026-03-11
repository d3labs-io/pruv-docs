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
        "ENTRY_FEE_TIMING": int(os.getenv("ENTRY_FEE_TIMING") or 0),
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
    desired_assets_input = sys.argv[2] if len(sys.argv) > 2 else "100"
    shares_input = sys.argv[3] if len(sys.argv) > 3 else "25"

    env = get_env()

    w3 = Web3(Web3.HTTPProvider(env["RPC_URL"]))
    account = w3.eth.account.from_key(env["PRIVATE_KEY"])
    user = account.address

    rwa_abi = load_abi("RWAToken.json")
    whitelist_abi = load_abi("Whitelist.json")
    fee_abi = load_abi("RWAFee.json")

    vault = w3.eth.contract(address=env["RWA_TOKEN_ADDRESS"], abi=rwa_abi)
    whitelist = w3.eth.contract(address=env["WHITELIST_ADDRESS"], abi=whitelist_abi)

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
        ],
    )

    share_decimals = vault.functions.decimals().call()
    share_symbol = vault.functions.symbol().call()
    asset_decimals = asset.functions.decimals().call()
    asset_symbol = asset.functions.symbol().call()

    desired_assets = int(float(desired_assets_input) * (10**asset_decimals))
    shares = int(float(shares_input) * (10**share_decimals))

    fee_address = resolve_fee_address(vault, env)
    fee_contract = w3.eth.contract(address=fee_address, abi=fee_abi)

    entry_fee = fee_contract.functions.feeOnRaw(
        desired_assets, env["ENTRY_FEE_TIMING"]
    ).call()
    total_spend = desired_assets + entry_fee

    preview_deposit_shares = vault.functions.previewDeposit(total_spend).call()

    gross_assets = vault.functions.convertToAssets(shares).call()

    estimated_exit_fee = fee_contract.functions.feeOnTotal(
        gross_assets, env["EXIT_FEE_TIMING"]
    ).call()

    preview_redeem_net_assets = vault.functions.previewRedeem(shares).call()

    whitelisted = whitelist.functions.balanceOf(user, 1).call()
    asset_balance = asset.functions.balanceOf(user).call()
    allowance = asset.functions.allowance(user, env["RWA_TOKEN_ADDRESS"]).call()
    share_balance = vault.functions.balanceOf(user).call()
    max_redeem = vault.functions.maxRedeem(user).call()

    print("=== STATUS / DEBUG FLOW ===")
    print("User:", user)
    print("Whitelisted:", whitelisted)
    print("Vault:", env["RWA_TOKEN_ADDRESS"])
    print("Whitelist:", env["WHITELIST_ADDRESS"])
    print("Fee contract:", fee_address)
    print("Asset token:", asset_symbol, asset_address)
    print("Share token:", share_symbol, env["RWA_TOKEN_ADDRESS"])
    print("")
    print("--- Balances ---")
    print("Asset balance:", asset_balance / (10**asset_decimals), asset_symbol)
    print("Allowance to vault:", allowance / (10**asset_decimals), asset_symbol)
    print("Share balance:", share_balance / (10**share_decimals), share_symbol)
    print("maxRedeem:", max_redeem / (10**share_decimals), share_symbol)
    print("")
    print("--- Deposit preview ---")
    print("Desired assets before fee:", desired_assets_input, asset_symbol)
    print("Entry fee (feeOnRaw):", entry_fee / (10**asset_decimals), asset_symbol)
    print("Total spend:", total_spend / (10**asset_decimals), asset_symbol)
    print(
        "previewDeposit(totalSpend):",
        preview_deposit_shares / (10**share_decimals),
        share_symbol,
    )
    print("")
    print("--- Redeem preview ---")
    print("Input shares:", shares_input, share_symbol)
    print(
        "convertToAssets(shares) [gross info]:",
        gross_assets / (10**asset_decimals),
        asset_symbol,
    )
    print(
        "Estimated exit fee (feeOnTotal):",
        estimated_exit_fee / (10**asset_decimals),
        asset_symbol,
    )
    print(
        "previewRedeem(shares) [final net]:",
        preview_redeem_net_assets / (10**asset_decimals),
        asset_symbol,
    )


if __name__ == "__main__":
    main()
