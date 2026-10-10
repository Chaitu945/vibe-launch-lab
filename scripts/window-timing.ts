/**
 * Time a scan for a given window. Prints per-chunk progress so a hang is obvious.
 *
 *   npx tsx scripts/window-timing.ts 24
 */
import { blocksForHours } from "../src/lib/chain";
import { scanLaunches, enrichLaunches } from "../src/lib/scan";

const hours = Number(process.argv[2] ?? 24);
const blocks = blocksForHours(hours);
const t0 = Date.now();
console.log(`window ${hours}h = ${blocks.toLocaleString()} blocks`);

let last = 0;
const res = await scanLaunches({
  windowBlocks: blocks,
  onProgress: (p) => {
    const t = Date.now();
    if (t - last > 1500) {
      last = t;
      console.log(
        `  [${((t - t0) / 1000).toFixed(1)}s] ${p.doneBlocks.toLocaleString()}/${p.totalBlocks.toLocaleString()} blocks · ${p.launches} launches · ${p.label}`,
      );
    }
  },
});
console.log(
  `scan done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${res.launches.length} launches, chunks=${res.chunks}, halvings=${res.halvings}, malformed=${res.decodeFailures}, ignored=${res.ignoredLogs}`,
);

const t1 = Date.now();
const rows = await enrichLaunches(res.launches.slice(0, 24), {});
console.log(`enriched 24 rows in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(rows.slice(0, 3).map((r) => `${r.symbol} ${r.factoryLabel} ${r.name}`).join(" | "));
