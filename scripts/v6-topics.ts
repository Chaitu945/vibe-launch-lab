/**
 * Partition every log a factory emits, with NO topic filter (this RPC ignores
 * topics anyway), and report which topic0s actually carry launch events.
 *
 *   npx tsx scripts/v6-topics.ts [factoryLabel]
 */
import { createPublicClient, http, getAddress } from "viem";
import { CHAIN, FACTORIES } from "../src/lib/chain";
import { decodeV6Launch, decodeClassicLaunch } from "../src/lib/scan";

const label = process.argv[2] ?? "v6";
const factory = FACTORIES.find((f) => f.label === label)!;
const client = createPublicClient({ transport: http(CHAIN.rpc, { timeout: 30_000 }) });

const head = Number(await client.getBlockNumber());
const window = Number(process.argv[3] ?? 60_000);
const logs = await client.getLogs({
  address: getAddress(factory.address),
  fromBlock: BigInt(head - window),
  toBlock: BigInt(head),
});
console.log(`${factory.label} ${factory.address}: ${logs.length} logs in ${window.toLocaleString()} blocks (no topic filter)\n`);

const perTopic = new Map<string, { total: number; v6: number; classic: number; shapes: Set<string>; names: string[] }>();
for (const l of logs) {
  const t = l.topics[0] ?? "?";
  const e = perTopic.get(t) ?? { total: 0, v6: 0, classic: 0, shapes: new Set<string>(), names: [] };
  e.total++;
  const words = (l.data.length - 2) / 64;
  e.shapes.add(`${l.topics.length}t/${words}w`);
  try {
    if (decodeV6Launch(l, factory)) {
      e.v6++;
      if (e.names.length < 2) e.names.push(decodeV6Launch(l, factory)!.symbolHint ?? "?");
    } else if (decodeClassicLaunch(l, factory)) {
      e.classic++;
    }
  } catch {
    /* neither */
  }
  perTopic.set(t, e);
}

for (const [t, e] of [...perTopic.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(
    `  ${t}\n     total=${e.total} v6_launch=${e.v6} classic_launch=${e.classic} other=${e.total - e.v6 - e.classic}` +
      `  shapes=${[...e.shapes].slice(0, 4).join(" ")}${e.names.length ? `  e.g. ${e.names.join(", ")}` : ""}`,
  );
}
