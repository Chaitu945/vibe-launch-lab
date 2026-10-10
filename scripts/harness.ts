/**
 * Acceptance harness: runs the app's OWN modules (src/lib/scan.ts, src/lib/curve.ts)
 * against Robinhood Chain Testnet and asserts the model matches the deployed
 * contracts. This is not a reimplementation — it imports what the UI imports.
 *
 *   npx tsx scripts/harness.ts
 */
import { enrichLaunches, rowLaunchTimestamp, rowProgressBps, rowRaised, rowTarget, rowTaxBps, scanLaunches, verifyCurve } from "../src/lib/scan";
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
check(
  "classification is exact: zero malformed launch logs",
  scan.decodeFailures === 0,
  `${scan.decodeFailures} malformed${scan.firstDecodeError ? ` (${scan.firstDecodeError})` : ""}`,
);
check(
  "non-launch protocol events are counted as ignored, not errors",
  scan.ignoredLogs > 0,
  `${scan.ignoredLogs} ignored`,
);

const sample = scan.launches.slice(0, 12);
// The feed is V6-dominated right now, so deliberately include classic rows too:
// the model-vs-contract check only applies to classic curves and must never be
// skipped just because the newest launches happen to all be V6.
const classicExtras = scan.launches.filter((l) => l.curveKind === "classic").slice(0, 4);
const toEnrich = [...sample, ...classicExtras.filter((c) => !sample.includes(c))];
const rows = await enrichLaunches(toEnrich, { onProgress: () => undefined });
console.log("\n--- enriched sample ---");
for (const r of rows) {
  console.log(
    `${r.name.padEnd(18)} ${(r.symbol ?? "").padEnd(10)} ${r.factoryLabel.padEnd(4)} ${r.curveKind.padEnd(7)} raised=${fmtEth(rowRaised(r))} target=${
      rowTarget(r) !== null && rowTarget(r)! > 0n ? fmtEth(rowTarget(r)) : "unverified"
    } progress=${pct(rowProgressBps(r))} price=${fmtPrice(r.spotPriceWad)}${r.priceSource === "quote" ? "(quote)" : ""} fdv=${fmtEth(r.fdvWei, 3)} tax=${rowTaxBps(r) !== null ? `${Number(rowTaxBps(r)) / 100}%` : "—"}`,
  );
}
check("enrichment returned rows", rows.length > 0);
check("every enriched row has a name", rows.every((r) => r.name && r.name !== "(no name)"));
check("every enriched row resolved a curve kind", rows.every((r) => r.curveKind === "classic" || r.curveKind === "v6"));
check("every enriched row has curve state", rows.every((r) => r.state !== null || r.v6 !== null));
check(
  "V6 rows carry a quote-derived price and a real target",
  rows.filter((r) => r.curveKind === "v6").every((r) => r.v6?.targetWei !== null && r.spotPriceWad !== null),
  `${rows.filter((r) => r.curveKind === "v6").length} V6 row(s) in sample`,
);
// Field-mapping sanity: these would all pass with a shifted multicall offset.
check(
  "spot price is in a plausible band (1e-12 … 1e-3 ETH per token)",
  rows.every((r) => r.spotPriceWad !== null && r.spotPriceWad > 10n ** 6n && r.spotPriceWad < 10n ** 15n),
);
check("FDV is positive and sub-1000 ETH", rows.every((r) => r.fdvWei !== null && r.fdvWei > 0n && r.fdvWei < 10n ** 21n));
check(
  "graduation target is unverified (null/0) or a real target (>= 1e15 wei)",
  rows.every((r) => {
    const t = rowTarget(r);
    return t === null || t === 0n || t >= 10n ** 15n;
  }),
);
check(
  "trade tax is one of the observed policies",
  rows.every((r) => {
    const t = rowTaxBps(r);
    // 100/200/300 are the creator-selectable taxes (1%/2%/3%); 125 is the protocol fee on classic curves.
    return t === null || [100n, 125n, 200n, 300n].includes(t);
  }),
);
check(
  "launch timestamps are within the last 90 days",
  rows.every((r) => {
    const t = rowLaunchTimestamp(r);
    return t !== null && t > Math.floor(Date.now() / 1000) - 90 * 86_400;
  }),
);
check("progress is within 0..10000 bps", rows.every((r) => rowProgressBps(r) === null || (rowProgressBps(r)! >= 0 && rowProgressBps(r)! <= 10_000)));
check(
  "for classic rows the model spot price equals the on-chain spotPriceWad field",
  rows
    .filter((r) => r.state !== null)
    .every((r) => {
      const st = r.state!;
      if (st.virtualToken === 0n) return false;
      const derived = (st.virtualEth * 10n ** 18n) / st.virtualToken;
      return r.spotPriceWad === derived;
    }),
);

console.log("\n--- model vs contract ---");
let allGood = true;
let checkedCurves = 0;
for (const r of rows.filter((x) => x.curveKind === "classic")) {
  checkedCurves++;
  try {
    const v = await verifyCurve(r.curve);
    const spotOk = v.spotDeltaWei === 0n;
    const tokenOk = v.tokenDelta === 0n || v.tokenDelta === -1n || v.tokenDelta === 1n || v.curveExhausted;
    allGood = allGood && spotOk && tokenOk;
    console.log(
      `${r.symbol.padEnd(10)} spot: ${spotOk ? "exact" : `delta ${v.spotDeltaWei}`} · quoteBuy(0.01 ETH): ${
        v.curveExhausted ? "curve exhausted (0 tokens left — chain and model agree)" : `chain=${fmtTokens(v.chainTokens, 4)} model delta=${v.tokenDelta} wei`
      } · fee=${v.feeBps}bps`,
    );
  } catch (e) {
    allGood = false;
    console.log(`${r.symbol.padEnd(10)} verification error: ${String(e).slice(0, 120)}`);
  }
}
check("model reproduces every tested curve (spot exact, tokens within 1 wei)", allGood && checkedCurves > 0, `${checkedCurves} classic curve(s)`);

// "all" is a multi-minute scan, so exercise the path with a hard stop instead of
// asserting an end-to-end run that would take ages in a test.
const tAll = Date.now();
const allScan = await scanLaunches({ windowBlocks: "all", shouldStop: () => Date.now() - tAll > 20_000 });
check(
  "'all' window scans back toward the first factory deployment",
  allScan.launches.length > 0,
  `${allScan.launches.length} launches in ${((Date.now() - tAll) / 1000).toFixed(0)}s (stopped early by design)`,
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
