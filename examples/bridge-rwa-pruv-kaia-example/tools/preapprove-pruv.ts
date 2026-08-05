import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Reads PRIVATE_KEY from scripts-mint/.env (any package's .env works).
dotenv.config({ path: path.resolve(__dirname, '..', 'scripts-mint', '.env') });
const ERC20 = ['function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function symbol() view returns (string)'];
const USDT = '0xc547f385c7D0A50Bb4b4889dF4d863F0abAD2885';
const KAI  = '0x16cE242211458bd215eC7304367520F60B0D09c9'; // vault == KAI token
const USDC = '0xeCacC484026a02022565496E088CA0581cC36373';
const VAULT = KAI;
const RWA_WARP  = '0x6a7ac9211E92cF0c4481BC606666b30B2d110592';
const USDT_WARP = '0xe0f0a2d91ca9a3db5635048f8b2be4a016bba592';

const PAIRS: [string, string, string][] = [
  [USDT, VAULT,     '50'],
  [USDT, USDT_WARP, '50'],
  [KAI,  RWA_WARP,  '500'],
  [KAI,  VAULT,     '500'],
  [USDC, RWA_WARP,  '5'],
  [USDC, USDT_WARP, '5'],
];

(async () => {
  const p = new ethers.JsonRpcProvider('https://rpc.testnet.pruv.network');
  const w = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  for (const [token, spender, human] of PAIRS) {
    const c = new ethers.Contract(token, ERC20, w);
    const sym = await c.symbol();
    const want = ethers.parseUnits(human, 6);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const cur: bigint = await c.allowance(w.address, spender);
      if (cur >= want) { console.log(`${sym} -> ${spender.slice(0,10)}: ok (${ethers.formatUnits(cur,6)})`); break; }
      try {
        const nonce = await p.getTransactionCount(w.address, 'pending');
        const tx = await c.approve(spender, want, { nonce });
        await Promise.race([tx.wait(), new Promise((_, r) => setTimeout(() => r(new Error('receipt timeout 25s')), 25_000))]);
        console.log(`${sym} -> ${spender.slice(0,10)}: approved ${human}`);
      } catch (e: any) {
        console.log(`${sym} -> ${spender.slice(0,10)}: attempt ${attempt} failed (${e.shortMessage || e.message})`);
      }
    }
  }
})();
