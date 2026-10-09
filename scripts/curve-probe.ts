/**
 * Probe two curve implementations with the same getter list and report the exact
 * error for each failure (rather than treating a revert as "function absent").
 *
 *   npx tsx scripts/curve-probe.ts
 */
import { createPublicClient, http, parseAbi, getAddress } from "viem";

const client = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 30_000 }) });

const abi = parseAbi([
  "function virtualEthReserve() view returns (uint256)",
  "function virtualTokenReserve() view returns (uint256)",
  "function realEthReserve() view returns (uint256)",
  "function netEthReserve() view returns (uint256)",
  "function initialVirtualEthReserve() view returns (uint256)",
  "function spotPriceWad() view returns (uint256)",
  "function fdvWei() view returns (uint256)",
  "function TOTAL_FEE_BPS() view returns (uint256)",
  "function NET_GRADUATION_TARGET() view returns (uint256)",
  "function INITIAL_VIRTUAL_ETH_RESERVE() view returns (uint256)",
  "function tokensSoldFromCurve() view returns (uint256)",
  "function curveTokensRemaining() view returns (uint256)",
  "function launchTimestamp() view returns (uint256)",
  "function complete() view returns (bool)",
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function quoteCurrency() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function graduationTarget() view returns (uint256)",
  "function raised() view returns (uint256)",
]);

const FNS = [
  "virtualEthReserve",
  "virtualTokenReserve",
  "realEthReserve",
  "netEthReserve",
  "initialVirtualEthReserve",
  "spotPriceWad",
  "fdvWei",
  "TOTAL_FEE_BPS",
  "NET_GRADUATION_TARGET",
  "INITIAL_VIRTUAL_ETH_RESERVE",
  "tokensSoldFromCurve",
  "curveTokensRemaining",
  "launchTimestamp",
  "complete",
  "token",
  "creator",
  "quoteCurrency",
  "totalSupply",
  "graduationTarget",
  "raised",
] as const;

const targets: Record<string, string> = {
  "V6 curve (theirs)": "0xb36F19a0D8A94e2C21215dD8cCB46E6385E882A3",
  "earlier curve (EthMoon)": "0x09BeD5F046e5a9ae10c6dc50104071C76Cd26cad",
};

for (const [label, addr] of Object.entries(targets)) {
  console.log(`\n=== ${label} ${addr} ===`);
  for (const fn of FNS) {
    try {
      const v = await client.readContract({ address: getAddress(addr), abi, functionName: fn });
      console.log(`  OK    ${fn.padEnd(28)} ${String(v).slice(0, 44)}`);
    } catch (e) {
      const msg = String(e)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("{") && !l.startsWith("}") && !l.startsWith("name:") && !l.startsWith("type:"))
        .slice(0, 2)
        .join(" | ")
        .slice(0, 150);
      console.log(`  FAIL  ${fn.padEnd(28)} ${msg}`);
    }
  }
}
