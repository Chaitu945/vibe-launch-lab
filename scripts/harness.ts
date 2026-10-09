/**
 * Acceptance harness: runs the app's OWN modules (src/lib/scan.ts, src/lib/curve.ts)
 * against Robinhood Chain Testnet and asserts the model matches the deployed
 * contracts. This is not a reimplementation — it imports what the UI imports.
 *
 *   npx tsx scripts/harness.ts
 */
import { enrichLaunches, scanLaunches, verifyCurve } from "../src/lib/scan";
import { fmtEth, fmtPrice, fmtTokens, pct } from "../src/lib/format";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const t0 = Date.now();
const scan = await scanLaunches({ windowBlocks: 1_750_000, onProgress: () => undefined });
console.log(`\nscanned head ${scan.head.toLocaleString()} · ${scan.launches.length} launches · ${scan.chunks} chunks · ${scan.halvings} halvings · ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const byGen = scan.launches.reduce<Record<string, number>>((a, l) => {
  a[l.factoryLabel] = (a[l.factoryLabel] ?? 0) + 1;
  return a;
}, {});
console.log("by generation:", byGen);

check("scan returned launches", scan.launches.length > 0, `${scan.launches.length} found`);
check("scan covers more than one generation", Object.keys(byGen).length > 1, Object.keys(byGen).join(", "));

const rows = await enrichLaunches(scan.launches.slice(0, 6), { onProgress: () => undefined });
console.log("\n--- enriched sample ---");
for (const r of rows) {
  console.log(
    `${r.name.padEnd(18)} ${(r.symbol ?? "").padEnd(10)} ${r.factoryLabel} raised=${fmtEth(r.state?.realEth)} target=${
      r.state && r.state.target > 0n ? fmtEth(r.state.target) : "unverified"
    } progress=${pct(r.progressBps)} price=${fmtPrice(r.spotPriceWad)} fdv=${fmtEth(r.fdvWei, 3)} sold=${fmtTokens(r.state?.virtualToken ?? null)}`,
  );
}
check("enrichment returned rows", rows.length > 0);
check("every enriched row has a name", rows.every((r) => r.name && r.name !== "(no name)"));
check("every enriched row has curve state", rows.every((r) => r.state !== null));
check(
  "curve state is internally consistent (virtualEth = E0 + realEth)",
  rows.every((r) => {
    if (!r.state) return false;
    const e0 = r.state.virtualEth - r.state.realEth;
    return e0 > 0n && r.state.virtualEth > r.state.realEth;
  }),
);
// Field-mapping sanity: these would all pass with a shifted multicall offset.
check(
  "spot price is in a plausible band (1e-12 … 1e-3 ETH per token)",
  rows.every((r) => r.spotPriceWad !== null && r.spotPriceWad > 10n ** 6n && r.spotPriceWad < 10n ** 15n),
);
check("FDV is positive and sub-1000 ETH", rows.every((r) => r.fdvWei !== null && r.fdvWei > 0n && r.fdvWei < 10n ** 21n));
check(
  "graduation target is unverified (null/0) or a real target (>= 1e15 wei)",
  rows.every((r) => !r.state || r.state.target === 0n || r.state.target >= 10n ** 15n),
);
check("fee bps is one of the observed policies", rows.every((r) => r.state !== null && [100n, 125n, 300n].includes(r.state.feeBps)));
check(
  "launch timestamps are within the last 90 days",
  rows.every((r) => r.launchTimestamp !== null && r.launchTimestamp > Math.floor(Date.now() / 1000) - 90 * 86_400),
);
check("progress is within 0..10000 bps", rows.every((r) => r.progressBps === null || (r.progressBps >= 0 && r.progressBps <= 10_000)));
check(
  "model spot price equals the on-chain spotPriceWad field",
  rows.every((r) => {
    if (!r.state || r.spotPriceWad === null) return false;
    const e0 = r.state.virtualEth - r.state.realEth;
    if (e0 <= 0n || r.state.virtualToken === 0n) return false;
    const derived = (r.state.virtualEth * 10n ** 18n) / r.state.virtualToken;
    return r.spotPriceWad === derived;
  }),
);

console.log("\n--- model vs contract ---");
let allGood = true;
for (const r of rows) {
  try {
    const v = await verifyCurve(r.curve);
    const spotOk = v.spotDeltaWei === 0n;
    const tokenOk = v.tokenDelta === 0n || v.tokenDelta === -1n || v.tokenDelta === 1n;
    allGood = allGood && spotOk && tokenOk;
    console.log(
      `${r.symbol.padEnd(10)} spot: ${spotOk ? "exact" : `delta ${v.spotDeltaWei}`} · quoteBuy(0.01 ETH): chain=${fmtTokens(v.chainTokens, 4)} model delta=${v.tokenDelta} wei · fee=${v.feeBps}bps`,
    );
  } catch (e) {
    allGood = false;
    console.log(`${r.symbol.padEnd(10)} verification error: ${String(e).slice(0, 120)}`);
  }
}
check("model reproduces every tested curve (spot exact, tokens within 1 wei)", allGood);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
