/**
 * Probe the V6 curve for its reserve / price getters by trying candidate names
 * as raw eth_call (no ABI needed): a 32-byte return is decoded as a word, and a
 * revert or empty return means the member is not there.
 *
 *   node scripts/v6-probe2.mjs
 */
import { createPublicClient, http, getAddress, keccak256, stringToHex, hexToBigInt } from "viem";

const client = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 30_000 }) });
const CURVE = getAddress("0xb36F19a0D8A94e2C21215dD8cCB46E6385E882A3");
const TOKEN = getAddress("0x1277e53FDA036CD5C922F0409D97BCf6Cf193960");

const candidates = [
  // reserves / principal
  "pairPrincipal", "pairReserve", "virtualPairReserve", "realPairReserve", "netPairReserve", "virtualPair", "principal", "raised",
  "netRaised", "netRaisedWei", "netEthReserve", "netQuoteReserve", "quoteReserve", "reserve", "reserves",
  // tokens
  "tokenReserve", "virtualTokenReserve", "tokenPrincipal", "curveTokens", "tokensRemaining", "unsoldTokens", "remaining", "sold",
  // price / valuation
  "spotPrice", "spotPriceWad", "priceWad", "price", "lastPrice", "marginalPrice", "fdv", "fdvWei", "fdvPair", "marketCap",
  // supply / limits
  "totalSupply", "TOTAL_SUPPLY", "SUPPLY", "curveAllocation", "maxTokens",
  // time / state
  "createdAt", "launchTimestamp", "complete", "graduated", "netGraduationTarget", "graduationTarget", "targetPairUnits",
  // fees / config
  "baseTaxBps", "currentRateBps", "totalFeeBps", "TOTAL_FEE_BPS", "creatorFeeBps", "protocolFeeBps",
  // identity
  "token", "factory", "pairCurrency", "quoteCurrency", "creator", "creatorVault", "locker", "poolId", "treasury", "projectTreasury",
  "version", "generation", "curveType",
];

async function probe(name) {
  const data = keccak256(stringToHex(`${name}()`)).slice(0, 10);
  try {
    const out = await client.call({ to: CURVE, data });
    if (!out.data || out.data === "0x") return { name, status: "empty return" };
    const words = (out.data.length - 2) / 64;
    if (out.data.length === 66) {
      const v = hexToBigInt(out.data);
      const asAddr = v < 2n ** 160n && v > 0n ? ` (addr? 0x${v.toString(16).padStart(40, "0")})` : "";
      return { name, status: `uint256 ${v}${asAddr}` };
    }
    if (out.data.length === 130) {
      const a = hexToBigInt(`0x${out.data.slice(2, 66)}`);
      const b = hexToBigInt(`0x${out.data.slice(66, 130)}`);
      return { name, status: `(uint256,uint256) ${a} / ${b}` };
    }
    return { name, status: `${words} words: ${out.data.slice(0, 80)}…` };
  } catch {
    return { name, status: "reverts" };
  }
}

const results = [];
for (const c of candidates) results.push(await probe(c));

const live = results.filter((r) => !["reverts", "empty return"].includes(r.status));
const dead = results.filter((r) => r.status === "reverts");

console.log("=== members that RESPOND on the V6 curve ===");
for (const r of live) console.log(`  ${r.name.padEnd(24)} ${r.status}`);
console.log(`\n=== revert (${dead.length}): ${dead.map((d) => d.name).join(", ")}`);

// Cross-check the token address read as a sanity signal
console.log(`\n(control) expected token in curve: ${TOKEN}`);
