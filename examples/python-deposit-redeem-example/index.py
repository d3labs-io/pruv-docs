import sys
import os

flow = sys.argv[1] if len(sys.argv) > 1 else None
args = sys.argv[2:]

if not flow:
    print("Usage:")
    print("  python index.py deposit <desiredAssetsBeforeFee>")
    print("  python index.py redeem <shares>")
    print("  python index.py price [desiredAssetsBeforeFee] [shares]")
    print("  python index.py status [desiredAssetsBeforeFee] [shares]")
    sys.exit(1)

supported = {"deposit", "redeem", "price", "status"}
if flow not in supported:
    print(f"Unsupported flow: {flow}")
    sys.exit(1)

os.chdir(os.path.dirname(os.path.abspath(__file__)))

if flow == "deposit":
    import deposit

    deposit.main()
elif flow == "redeem":
    import redeem

    redeem.main()
elif flow == "price":
    import price

    price.main()
elif flow == "status":
    import status

    status.main()
