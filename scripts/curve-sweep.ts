/**
 * Sweep the model against every distinct curve in a window.
 *
 *   npx tsx scripts/curve-sweep.ts [hours]
 *
 * The harness checks the handful of curves in the newest page of rows. This checks
 * hundreds, which is what actually exercises the edge cases: near-empty curves, curves
 * whose remaining allocation caps the quote, and any curve shape the formula does not
 * describe. Prints every disagreement with its numbers instead of a bare failure count.
 */
import { scanLaunches, verifyCurve } from "../src/lib/scan";
import { fmtTokens } from "../src/lib/format";

const hours = Number(process.argv[2] ?? 24);
const blocksPerHour = Math.round(3600 / 0.15);

const scan = await scanLaunches({ windowBlocks: hours * blocksPerHour });
const curves = [...new Set(scan.launches.map((l) => l.curve.toLowerCase()))];
console.log(`scanned ${scan.launches.length} launches in ${hours}h: ${curves.length} distinct curves`);

const batchSize = 8;
let checked = 0;
let exact = 0;
let capped = 0;
let exhausted = 0;
const bad: string[] = [];

for (let i = 0; i < curves.length; i += batchSize) {
  const batch = curves.slice(i, i + batchSize);
  const results = await Promise.all(
    batch.map(async (c) => {
      try {
        return await verifyCurve(c);
      } catch (e) {
        return { curve: c, error: String(e).slice(0, 120) } as const;
      }
    }),
  );
  for (const r of results) {
    checked += 1;
    if ("error" in r) {
      bad.push(`${r.curve} threw: ${r.error}`);
      continue;
    }
    if (r.curveExhausted) exhausted += 1;
    if (r.cappedByRemaining) capped += 1;
    const tokenOk = r.tokenDelta === 0n || r.tokenDelta === -1n || r.tokenDelta === 1n || r.curveExhausted;
    if (r.spotDeltaWei === 0n && tokenOk) {
      exact += 1;
    } else {
      bad.push(
        `${r.curve} spotDelta=${r.spotDeltaWei} chain=${fmtTokens(r.chainTokens, 6)} model=${fmtTokens(
          r.modelTokens,
          6,
        )} uncapped=${fmtTokens(r.modelTokensUncapped, 6)} remaining=${r.tokensRemaining === null ? "n/a" : fmtTokens(r.tokensRemaining, 6)} capped=${r.cappedByRemaining}`,
      );
    }
  }
}

console.log(`checked ${checked} curves: ${exact} exact, ${capped} capped at remaining, ${exhausted} exhausted`);
if (bad.length > 0) {
  console.log(`\n${bad.length} DISAGREEMENT(S):`);
  for (const b of bad.slice(0, 20)) console.log("  " + b);
} else {
  console.log("no disagreements");
}
process.exit(bad.length === 0 ? 0 : 1);
