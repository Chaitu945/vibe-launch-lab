import { createPublicClient, http, decodeEventLog, getAddress, type Hex, type Log } from "viem";
import {
  CHAIN,
  FACTORIES,
  FACTORY_ABI,
  CURVE_ABI,
  ERC20_ABI,
  CURVE_READ_FNS,
  TOPICS,
  type FactoryInfo,
} from "./chain";
import { priceWad, type CurveState } from "./curve";

export const client = createPublicClient({
  transport: http(CHAIN.rpc, { timeout: 30_000, retryCount: 2 }),
});

/**
 * Raw log query. viem's typed overloads don't model a two-topic0 query with no
 * ABI, which is exactly what scanning two launch-event variants needs, so the
 * params are cast here rather than worked around with an inferred ABI.
 */
async function rawGetLogs(params: {
  address: `0x${string}`;
  topics: Hex[];
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<Log[]> {
  const run = client.getLogs as unknown as (p: typeof params) => Promise<Log[]>;
  return run(params);
}

export interface RawLaunch {
  generation: FactoryInfo["generation"];
  factoryLabel: string;
  factory: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  launchId: bigint;
  token: string;
  curve: string;
  creator: string;
  quoteCurrency: string | null;
  initialBuy: bigint;
  metadataURI: string;
  quoted: boolean;
}

export interface LaunchRow extends RawLaunch {
  name: string;
  symbol: string;
  transfersUnlocked: boolean | null;
  state: CurveState | null;
  curveTokensRemaining: bigint | null;
  spotPriceWad: bigint | null;
  fdvWei: bigint | null;
  graduated: boolean | null;
  launchTimestamp: number | null;
  progressBps: number | null;
  enrichmentError: string | null;
}

export interface ScanProgress {
  label: string;
  doneBlocks: number;
  totalBlocks: number;
  launches: number;
}

export interface ScanOptions {
  windowBlocks: number;
  onProgress?: (p: ScanProgress) => void;
  shouldStop?: () => boolean;
  /** Initial eth_getLogs chunk size. Halves on RPC errors (time/result limits). */
  chunkBlocks?: number;
}

export async function getHead(): Promise<number> {
  const n = await client.getBlockNumber();
  return Number(n);
}

/**
 * Scan `TokenLaunched` (+ the rare `TokenLaunchedQuoted`) across every known
 * factory generation.
 *
 * The public RPC refuses address-less log queries and enforces two undocumented
 * limits: a wall-clock limit on the query span, and a hard cap of 10,000 logs per
 * response. So the scan walks backwards in chunks and halves the chunk size on
 * any error, rather than assuming a fixed range is safe.
 */
export async function scanLaunches(
  opts: ScanOptions,
): Promise<{ launches: RawLaunch[]; head: number; chunks: number; halvings: number; decodeFailures: number; firstDecodeError: string | null }> {
  const head = await getHead();
  const totalBlocks = opts.windowBlocks;
  let chunk = opts.chunkBlocks ?? 100_000;
  let halvings = 0;
  const out: RawLaunch[] = [];
  // Two topic0 values: the normal launch event and the rare stock-paired variant.
  const topics = [TOPICS.TokenLaunched, TOPICS.TokenLaunchedQuoted] as [Hex, ...Hex[]];

  const tasks: { factory: FactoryInfo; from: number; to: number }[] = [];
  for (const factory of FACTORIES) {
    let to = head;
    const floor = Math.max(head - totalBlocks, factory.deploymentBlock);
    while (to > floor) {
      const from = Math.max(floor, to - chunk);
      tasks.push({ factory, from, to });
      to = from;
    }
  }

  let done = 0;
  const blocksTotal = tasks.reduce((a, t) => a + (t.to - t.from), 0);
  let i = 0;
  let decodeFailures = 0;
  let firstDecodeError: string | null = null;
  while (i < tasks.length) {
    if (opts.shouldStop?.()) break;
    const t = tasks[i];
    let logs: Log[];
    try {
      logs = await rawGetLogs({
        address: getAddress(t.factory.address),
        topics,
        fromBlock: BigInt(t.from),
        toBlock: BigInt(t.to),
      });
    } catch (err) {
      // Only RPC-side failures land here (time limits, result caps, transport).
      const half = Math.floor(chunk / 2);
      if (half >= 2_000) {
        chunk = half;
        halvings++;
        // Re-split this task into two smaller halves and retry.
        const mid = t.to - half;
        tasks.splice(i, 1, { factory: t.factory, from: mid, to: t.to }, { factory: t.factory, from: t.from, to: mid });
        opts.onProgress?.({ label: `RPC limit hit — halving window to ${half.toLocaleString()} blocks`, doneBlocks: done, totalBlocks: blocksTotal, launches: out.length });
        continue;
      }
      // Give up on this slice rather than aborting the whole scan.
      i++;
      continue;
    }

    // Decoding is separated from the RPC call on purpose: a decode failure is a
    // bug in this app's ABI, NOT an RPC limit, and must never be silently
    // swallowed by the halving path.
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: FACTORY_ABI,
          data: log.data,
          topics: log.topics,
        });
        const a = decoded.args as unknown as Record<string, unknown>;
        const quoted = decoded.eventName === "TokenLaunchedQuoted";
        out.push({
          generation: t.factory.generation,
          factoryLabel: t.factory.label,
          factory: t.factory.address,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash ?? "",
          logIndex: Number(log.logIndex ?? 0),
          launchId: (a.launchId as bigint) ?? 0n,
          token: (a.token as string) ?? "",
          curve: (a.curve as string) ?? "",
          creator: (a.creator as string) ?? "",
          quoteCurrency: quoted ? ((a.quoteCurrency as string) ?? null) : null,
          initialBuy: (a.initialBuy as bigint) ?? 0n,
          metadataURI: (a.metadataURI as string) ?? "",
          quoted,
        });
      } catch (err) {
        decodeFailures++;
        if (firstDecodeError === null) firstDecodeError = String(err).split("\n")[0].slice(0, 200);
      }
    }
    done += t.to - t.from;
    opts.onProgress?.({
      label: `${t.factory.label} ${t.from.toLocaleString()}–${t.to.toLocaleString()}`,
      doneBlocks: done,
      totalBlocks: blocksTotal,
      launches: out.length,
    });
    i++;
  }

  out.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  return { launches: out, head, chunks: tasks.length, halvings, decodeFailures, firstDecodeError };
}

/** Bucket launches into hourly windows for the activity strip. */
export function activityBuckets(launches: RawLaunch[], head: number, hours: number, blocksPerHour: number): { label: string; count: number }[] {
  const buckets = new Array(hours).fill(0).map((_, idx) => ({ label: `-${hours - idx}h`, count: 0 }));
  for (const l of launches) {
    const hoursAgo = Math.floor((head - l.blockNumber) / blocksPerHour);
    const idx = hours - 1 - hoursAgo;
    if (idx >= 0 && idx < hours) buckets[idx].count++;
  }
  return buckets;
}

const BATCH = 8;

/**
 * Enrich launches with on-chain identity (ERC-20 name/symbol) and curve state.
 * Batched through Multicall3 so a 40-row feed costs a handful of round trips.
 */
export async function enrichLaunches(rows: RawLaunch[], opts: { onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean } = {}): Promise<LaunchRow[]> {
  const result: LaunchRow[] = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    if (opts.shouldStop?.()) break;
    const slice = rows.slice(start, start + BATCH);
    const contracts = slice.flatMap((r) => [
      { address: getAddress(r.token), abi: ERC20_ABI, functionName: "name" as const },
      { address: getAddress(r.token), abi: ERC20_ABI, functionName: "symbol" as const },
      { address: getAddress(r.token), abi: ERC20_ABI, functionName: "transfersUnlocked" as const },
      ...CURVE_READ_FNS.map((fn) => ({ address: getAddress(r.curve), abi: CURVE_ABI, functionName: fn })),
    ]);

    let results: unknown[];
    try {
      results = (await client.multicall({
        contracts: contracts as never,
        allowFailure: true,
        multicallAddress: getAddress(CHAIN.multicall3),
      })) as unknown[];
    } catch {
      results = [];
    }

    slice.forEach((r, idx) => {
      // Offsets are derived from CURVE_READ_FNS so a change to the read list can
      // never silently shift which slot a field is read from.
      const base = idx * (3 + CURVE_READ_FNS.length);
      const slot = (fn: (typeof CURVE_READ_FNS)[number]) => base + 3 + CURVE_READ_FNS.indexOf(fn);
      const val = (offset: number): unknown => {
        const item = results[offset] as { status?: string; result?: unknown } | undefined;
        return item && item.status === "success" ? item.result : null;
      };
      const num = (offset: number): bigint | null => {
        const v = val(offset);
        return typeof v === "bigint" ? v : null;
      };
      const virtualEth = num(slot("virtualEthReserve"));
      const virtualToken = num(slot("virtualTokenReserve"));
      const realEth = num(slot("realEthReserve"));
      const feeBps = num(slot("TOTAL_FEE_BPS"));
      const target = num(slot("NET_GRADUATION_TARGET"));
      const complete = val(slot("complete"));
      const launchTimestamp = num(slot("launchTimestamp"));
      const state: CurveState | null =
        virtualEth !== null && virtualToken !== null && realEth !== null
          ? {
              virtualEth,
              virtualToken,
              realEth,
              feeBps: feeBps ?? 0n,
              creatorShareBps: 7_500n,
              target: target ?? 0n,
              complete: complete === true,
            }
          : null;
      const spot = num(slot("spotPriceWad"));
      result.push({
        ...r,
        name: (val(base) as string) ?? "(no name)",
        symbol: (val(base + 1) as string) ?? "?",
        transfersUnlocked: typeof val(base + 2) === "boolean" ? (val(base + 2) as boolean) : null,
        state,
        curveTokensRemaining: num(slot("curveTokensRemaining")),
        spotPriceWad: spot ?? (state ? priceWad(state) : null),
        fdvWei: num(slot("fdvWei")),
        graduated: complete === true ? true : null,
        launchTimestamp: launchTimestamp !== null ? Number(launchTimestamp) : null,
        progressBps: state && state.target > 0n ? Number((state.realEth * 10_000n) / state.target) : null,
        enrichmentError: results.length === 0 ? "multicall unavailable" : null,
      });
    });
    opts.onProgress?.(Math.min(start + BATCH, rows.length), rows.length);
  }
  return result;
}

export interface VerificationResult {
  curve: string;
  modelSpotWad: bigint;
  chainSpotWad: bigint;
  spotDeltaWei: bigint;
  buyProbeEth: bigint;
  modelTokens: bigint;
  chainTokens: bigint;
  tokenDelta: bigint;
  feeBps: bigint;
  target: bigint;
  realEth: bigint;
  ok: boolean;
}

/**
 * Compare this app's curve model against the deployed curve contract:
 * `spotPriceWad()` and `quoteBuy()`. The point of the whole tool is that these
 * agree; if they don't, the model is wrong and the simulator is worthless.
 */
export async function verifyCurve(curveAddress: string, probeEth = 10n ** 16n): Promise<VerificationResult> {
  const address = getAddress(curveAddress);
  const reads = await client.multicall({
    contracts: [
      { address, abi: CURVE_ABI, functionName: "virtualEthReserve" },
      { address, abi: CURVE_ABI, functionName: "virtualTokenReserve" },
      { address, abi: CURVE_ABI, functionName: "realEthReserve" },
      { address, abi: CURVE_ABI, functionName: "spotPriceWad" },
      { address, abi: CURVE_ABI, functionName: "TOTAL_FEE_BPS" },
      { address, abi: CURVE_ABI, functionName: "NET_GRADUATION_TARGET" },
      { address, abi: CURVE_ABI, functionName: "quoteBuy", args: [probeEth] },
    ],
    allowFailure: true,
    multicallAddress: getAddress(CHAIN.multicall3),
  });
  const pick = (i: number): unknown => {
    const item = reads[i] as { status?: string; result?: unknown } | undefined;
    return item && item.status === "success" ? item.result : null;
  };
  const virtualEth = (pick(0) as bigint) ?? 0n;
  const virtualToken = (pick(1) as bigint) ?? 0n;
  const realEth = (pick(2) as bigint) ?? 0n;
  const chainSpot = (pick(3) as bigint) ?? 0n;
  const feeBps = (pick(4) as bigint) ?? 0n;
  const target = (pick(5) as bigint) ?? 0n;
  const quote = pick(6) as readonly bigint[] | null;

  const state: CurveState = {
    virtualEth,
    virtualToken,
    realEth,
    feeBps,
    creatorShareBps: 7_500n,
    target,
    complete: false,
  };
  const modelSpot = priceWad(state);
  const k = virtualEth * virtualToken;
  const fee = (probeEth * feeBps) / 10_000n;
  const modelTokens = virtualToken - k / (virtualEth + (probeEth - fee));
  const chainTokens = (quote?.[0] as bigint) ?? 0n;
  const spotDelta = modelSpot - chainSpot;
  const tokenDelta = modelTokens - chainTokens;
  return {
    curve: address,
    modelSpotWad: modelSpot,
    chainSpotWad: chainSpot,
    spotDeltaWei: spotDelta,
    buyProbeEth: probeEth,
    modelTokens,
    chainTokens,
    tokenDelta,
    feeBps,
    target,
    realEth,
    ok: spotDelta === 0n && (tokenDelta === 0n || tokenDelta === -1n || tokenDelta === 1n),
  };
}
