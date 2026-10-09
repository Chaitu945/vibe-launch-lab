/**
 * Verify a single vibe/vibe launch on-chain.
 *
 *   npx tsx scripts/verify-token.ts 0x<token>
 *
 * Works on both curve implementations:
 *   - classic (gen1-3): reserve getters exist, the model is checked against quoteBuy()
 *   - V6: the getters revert, so raised/target/sold/tax are read from the renamed
 *     surface and the price is derived from the contract's own quote function
 *
 * Note on log search: this RPC honours only topic0, so the token is matched
 * client-side against every indexed topic rather than trusting a topics filter.
 */
import { createPublicClient, http, parseAbi, getAddress, decodeEventLog, hexToString, type Hex } from "viem";
import { CHAIN, FACTORIES, TOPICS } from "../src/lib/chain";
import { fmtEth, fmtPrice, fmtTokens, pct } from "../src/lib/format";

const token = getAddress(process.argv[2] ?? "");
const client = createPublicClient({ transport: http(CHAIN.rpc, { timeout: 30_000, retryCount: 2 }) });

const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function curve() view returns (address)",
  "function transfersUnlocked() view returns (bool)",
]);
const classicAbi = parseAbi([
  "function virtualEthReserve() view returns (uint256)",
  "function virtualTokenReserve() view returns (uint256)",
  "function realEthReserve() view returns (uint256)",
  "function spotPriceWad() view returns (uint256)",
  "function fdvWei() view returns (uint256)",
  "function launchTimestamp() view returns (uint256)",
  "function TOTAL_FEE_BPS() view returns (uint256)",
  "function NET_GRADUATION_TARGET() view returns (uint256)",
  "function INITIAL_VIRTUAL_ETH_RESERVE() view returns (uint256)",
  "function quoteBuy(uint256 grossEth) view returns (uint256 tokenAmount, uint256 grossEthUsed, uint256 curveQuote, uint256 totalFee, uint256 refund)",
]);
const v6Abi = parseAbi([
  "function pairPrincipal() view returns (uint256)",
  "function targetPairUnits() view returns (uint256)",
  "function sold() view returns (uint256)",
  "function baseTaxBps() view returns (uint256)",
  "function currentRateBps() view returns (uint256)",
  "function createdAt() view returns (uint256)",
  "function pairCurrency() view returns (address)",
  "function projectTreasury() view returns (address)",
  "function complete() view returns (bool)",
  "function factory() view returns (address)",
  "function quoteBuyExactIn(uint256 amountIn) view returns (uint256)",
]);
const factoryAbi = parseAbi([
  "event TokenLaunched(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)",
]);

const ok = (label: string, value: unknown) => console.log(`  ${label.padEnd(30)} ${value}`);

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ---------- token ----------
const [name, symbol, totalSupply, curveAddr, unlocked] = await Promise.all([
  safe(() => client.readContract({ address: token, abi: tokenAbi, functionName: "name" })),
  safe(() => client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" })),
  safe(() => client.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" })),
  safe(() => client.readContract({ address: token, abi: tokenAbi, functionName: "curve" })),
  safe(() => client.readContract({ address: token, abi: tokenAbi, functionName: "transfersUnlocked" })),
]);

console.log(`\nTOKEN ${token}`);
ok("name / symbol", `${name ?? "?"} / ${symbol ?? "?"}`);
ok("total supply", totalSupply !== null ? fmtTokens(totalSupply, 0) : "read failed");
ok("transfers unlocked", unlocked);
ok("curve", curveAddr ?? "no curve() member");

if (!curveAddr) {
  console.log("\nNo curve contract — this token was not launched through a vibevibe curve.");
  process.exit(0);
}

// ---------- launch event: match the token client-side across indexed topics ----------
const head = Number(await client.getBlockNumber());
const window = 300_000;
let launchOwner = "";
let classicArgs: Record<string, unknown> | null = null;
let v6Hit: { block: number; topics: string[]; name?: string; symbol?: string; uri?: string } | null = null;

for (const f of FACTORIES) {
  const topics: Hex[] =
    f.generation === "v6" ? [TOPICS.V6LaunchedA as Hex, TOPICS.V6LaunchedB as Hex] : [TOPICS.TokenLaunched as Hex];
  const logs = await safe(() =>
    client.getLogs({
      address: getAddress(f.address),
      topics,
      fromBlock: BigInt(Math.max(head - window, f.deploymentBlock)),
      toBlock: BigInt(head),
    }),
  );
  if (!logs) continue;

  for (const l of logs) {
    const hit = l.topics.slice(1).some((t) => (t ?? "").toLowerCase().endsWith(token.slice(2).toLowerCase()));
    if (!hit) continue;
    launchOwner = `${f.label} (${f.address}) at block ${Number(l.blockNumber)}`;
    if (f.generation === "v6") {
      // positional decode (see decodeV6Launch in src/lib/scan.ts)
      const w = (i: number) => "0x" + l.data.slice(2 + i * 64, 2 + (i + 1) * 64);
      const readStr = (offIdx: number): string | undefined => {
        const byteOffset = Number(BigInt(w(offIdx)));
        const lenIdx = byteOffset / 32;
        const len = Number(BigInt(w(lenIdx)));
        const start = (lenIdx + 1) * 32;
        const hex = l.data.slice(2 + start * 2, 2 + start * 2 + len * 2);
        try {
          return hexToString(`0x${hex}`);
        } catch {
          return undefined;
        }
      };
      v6Hit = { block: Number(l.blockNumber), topics: l.topics, name: readStr(1), symbol: readStr(2), uri: readStr(3) };
    } else {
      const d = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
      classicArgs = d.args as unknown as Record<string, unknown>;
    }
    break;
  }
}

console.log(`\nLAUNCH EVENT`);
ok("emitted by", launchOwner || "not found in the last 300k blocks");
if (classicArgs) {
  ok("launchId", String(classicArgs.launchId));
  ok("creator", String(classicArgs.creator));
  ok("opening buy", `${fmtEth(classicArgs.initialBuy as bigint, 4)} ETH`);
  ok("metadata URI", String(classicArgs.metadataURI));
} else if (v6Hit) {
  ok("launchId (topic1)", String(BigInt(v6Hit.topics[1] ?? "0x0")));
  ok("project treasury (topic2)", v6Hit.topics[2]);
  ok("name from event", v6Hit.name ?? "—");
  ok("symbol from event", v6Hit.symbol ?? "—");
  ok("metadata URI from event", v6Hit.uri ?? "—");
}

// ---------- curve: classic surface ----------
const classic = {
  virtualEth: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "virtualEthReserve" })),
  virtualToken: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "virtualTokenReserve" })),
  realEth: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "realEthReserve" })),
  spot: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "spotPriceWad" })),
  fdv: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "fdvWei" })),
  ts: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "launchTimestamp" })),
  feeBps: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "TOTAL_FEE_BPS" })),
  target: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "NET_GRADUATION_TARGET" })),
  quote: await safe(() => client.readContract({ address: curveAddr, abi: classicAbi, functionName: "quoteBuy", args: [10n ** 16n] })),
};
const isClassic = classic.virtualEth !== null && classic.virtualToken !== null;

if (isClassic) {
  console.log(`\nCURVE ${curveAddr} (classic)`);
  ok("raised", `${fmtEth(classic.realEth)} ETH`);
  ok("graduation target", `${fmtEth(classic.target)} ETH`);
  ok("progress", classic.target && classic.realEth !== null ? pct(Number((classic.realEth * 10_000n) / classic.target)) : "—");
  ok("spot price", `${fmtPrice(classic.spot)} ETH`);
  ok("FDV", `${fmtEth(classic.fdv, 4)} ETH`);
  ok("total fee bps", String(classic.feeBps));
  ok("tokens sold", fmtTokens(classic.virtualToken !== null && classic.virtualEth !== null ? classic.virtualToken : null));

  const k = (classic.virtualEth as bigint) * (classic.virtualToken as bigint);
  const fee = (10n ** 16n * (classic.feeBps ?? 0n)) / 10_000n;
  const modelTokens = (classic.virtualToken as bigint) - k / ((classic.virtualEth as bigint) + (10n ** 16n - fee));
  const modelSpot = ((classic.virtualEth as bigint) * 10n ** 18n) / (classic.virtualToken as bigint);
  console.log(`\nMODEL vs CONTRACT`);
  ok("spot price delta", `${modelSpot - (classic.spot ?? 0n)} wei ${modelSpot === classic.spot ? "(exact)" : ""}`);
  ok("quoteBuy(0.01 ETH) delta", `${modelTokens - (classic.quote?.[0] ?? 0n)} wei`);
  ok(
    "verdict",
    modelSpot === classic.spot && classic.quote && modelTokens - classic.quote[0] <= 1n && modelTokens - classic.quote[0] >= -1n
      ? "model reproduces the contract"
      : "MISMATCH",
  );
  process.exit(0);
}

// ---------- curve: V6 surface ----------
const v6 = {
  principal: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "pairPrincipal" })),
  target: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "targetPairUnits" })),
  sold: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "sold" })),
  taxBps: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "baseTaxBps" })),
  rateBps: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "currentRateBps" })),
  createdAt: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "createdAt" })),
  pairCurrency: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "pairCurrency" })),
  projectTreasury: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "projectTreasury" })),
  complete: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "complete" })),
  factory: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "factory" })),
  lo: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "quoteBuyExactIn", args: [10n ** 15n] })),
  hi: await safe(() => client.readContract({ address: curveAddr, abi: v6Abi, functionName: "quoteBuyExactIn", args: [2n * 10n ** 15n] })),
};

if (v6.principal === null && v6.target === null) {
  console.log(`\nCURVE ${curveAddr}: neither the classic nor the V6 surface responds — unknown implementation.`);
  process.exit(0);
}

const quotePriceWad =
  v6.lo !== null && v6.hi !== null && v6.hi > v6.lo ? ((2n * 10n ** 15n - 10n ** 15n) * 10n ** 18n) / (v6.hi - v6.lo) : null;

console.log(`\nCURVE ${curveAddr} (V6 — renamed surface, no reserve/price getters)`);
ok("raised (pairPrincipal)", `${fmtEth(v6.principal)} ETH`);
ok("graduation target", `${fmtEth(v6.target)} ETH`);
ok("progress", v6.principal !== null && v6.target !== null && v6.target > 0n ? pct(Number((v6.principal * 10_000n) / v6.target)) : "—");
ok("tokens sold", fmtTokens(v6.sold));
ok("trade tax (baseTaxBps)", v6.taxBps !== null ? `${Number(v6.taxBps) / 100}%` : "—");
ok("current decaying rate", v6.rateBps !== null ? `${Number(v6.rateBps) / 100}%` : "—");
ok("price (from quote)", `${fmtPrice(quotePriceWad)} ETH`);
ok("FDV (from quote)", quotePriceWad !== null && totalSupply !== null ? `${fmtEth((quotePriceWad * totalSupply) / 10n ** 18n, 4)} ETH` : "—");
ok("pair currency", v6.pairCurrency && v6.pairCurrency !== "0x0000000000000000000000000000000000000000" ? v6.pairCurrency : "native ETH");
ok("project treasury", v6.projectTreasury);
ok("factory()", v6.factory);
ok("complete", String(v6.complete));
ok("created at", v6.createdAt !== null ? new Date(Number(v6.createdAt) * 1000).toISOString() : "—");

console.log(`\nNOTE  the V6 curve shape is not recovered, so no model-vs-contract check is possible here.`);
console.log(`      raised, target, sold and tax are read directly; price is the marginal price from`);
console.log(`      quoteBuyExactIn() across a 0.001 → 0.002 ETH probe.`);
