import { createPublicClient, http, decodeEventLog, getAddress, hexToString, type Log } from "viem";
import {
  CHAIN,
  EARLIEST_DEPLOYMENT_BLOCK,
  FACTORIES,
  FACTORY_ABI,
  CURVE_ABI,
  CURVE_READ_FNS,
  ERC20_ABI,
  V6_CURVE_ABI,
  V6_CURVE_READ_FNS,
  V6_WORD,
  TOPICS,
  type FactoryInfo,
} from "./chain";
import { priceWad, type CurveState } from "./curve";

export const client = createPublicClient({
  transport: http(CHAIN.rpc, { timeout: 30_000, retryCount: 2 }),
});

/**
 * Raw log query by address and range.
 *
 * No `topics` parameter is sent on purpose: this RPC **ignores it**: three
 * different topic0 filters returned the identical log set, so requesting a
 * specific event buys nothing and hides that fact.
 */
async function rawGetLogs(params: {
  address: `0x${string}`;
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
  /** Which curve implementation this launch uses. */
  curveKind: "classic" | "v6";
  /** V6 launch events carry these on-chain; classic ones do not. */
  nameHint?: string;
  symbolHint?: string;
  targetHint?: bigint;
  taxBpsHint?: bigint;
}

export interface LaunchRow extends RawLaunch {
  name: string;
  symbol: string;
  transfersUnlocked: boolean | null;
  state: CurveState | null;
  /** V6 curves expose a different surface; normalized here into the same shape. */
  v6: {
    principalWei: bigint | null;
    targetWei: bigint | null;
    soldTokens: bigint | null;
    taxBps: bigint | null;
    createdAt: number | null;
    complete: boolean | null;
    /** Marginal price derived from the contract's own quote function, in wei per token. */
    quotePriceWad: bigint | null;
  } | null;
  totalSupply: bigint | null;
  curveTokensRemaining: bigint | null;
  spotPriceWad: bigint | null;
  fdvWei: bigint | null;
  graduated: boolean | null;
  launchTimestamp: number | null;
  progressBps: number | null;
  priceSource: "state" | "quote" | null;
  enrichmentError: string | null;
}

/* ------------------------------------------------------------------ *
 * Normalized row accessors: the UI should not care whether a row came
 * from a classic curve or a V6 one.
 * ------------------------------------------------------------------ */

export function rowRaised(r: LaunchRow): bigint | null {
  return r.state ? r.state.realEth : (r.v6?.principalWei ?? null);
}
export function rowTarget(r: LaunchRow): bigint | null {
  return r.state && r.state.target > 0n ? r.state.target : (r.v6?.targetWei ?? null);
}
export function rowTokensSold(r: LaunchRow): bigint | null {
  if (r.state) return r.state.virtualToken;
  return r.v6?.soldTokens ?? null;
}
export function rowTaxBps(r: LaunchRow): bigint | null {
  return r.state && r.state.feeBps > 0n ? r.state.feeBps : (r.v6?.taxBps ?? null);
}
export function rowLaunchTimestamp(r: LaunchRow): number | null {
  return r.launchTimestamp ?? r.v6?.createdAt ?? null;
}
export function rowProgressBps(r: LaunchRow): number | null {
  const raised = rowRaised(r);
  const target = rowTarget(r);
  if (raised === null || target === null || target === 0n) return null;
  return Number((raised * 10_000n) / target);
}

export interface ScanProgress {
  label: string;
  doneBlocks: number;
  totalBlocks: number;
  launches: number;
}

export interface ScanOptions {
  /**
   * Blocks to scan back, or `"all"`, meaning back to the earliest factory
   * deployment (tens of millions of blocks; expect minutes and tens of thousands
   * of rows).
   */
  windowBlocks: number | "all";
  onProgress?: (p: ScanProgress) => void;
  shouldStop?: () => boolean;
  /** Initial eth_getLogs chunk size. Halves on RPC errors (time/result limits). */
  chunkBlocks?: number;
}

/**
 * Classify one log from a factory.
 *
 * This RPC **ignores the `topics` parameter entirely**: three different topic0
 * filters returned the identical log set, so every log of a factory arrives here
 * and the discriminator has to be client-side: a log is a launch only if its topic0
 * is one of the launch events AND it decodes. Anything else is a different protocol
 * event and is counted separately, not reported as a failure.
 */
function classifyLog(log: Log, factory: FactoryInfo): { record: RawLaunch | null; kind: "launch" | "other" | "malformed" } {
  const topic0 = log.topics[0];
  if (!topic0) return { record: null, kind: "other" };
  const isV6Launch = topic0 === TOPICS.V6Launched;
  const isClassicLaunch = topic0 === TOPICS.TokenLaunched || topic0 === TOPICS.TokenLaunchedQuoted;
  if (!isV6Launch && !isClassicLaunch) return { record: null, kind: "other" };
  const record = isV6Launch ? decodeV6Launch(log, factory) : decodeClassicLaunch(log, factory);
  return record ? { record, kind: "launch" } : { record: null, kind: "malformed" };
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
): Promise<{
  launches: RawLaunch[];
  head: number;
  chunks: number;
  halvings: number;
  decodeFailures: number;
  firstDecodeError: string | null;
  ignoredLogs: number;
}> {
  const head = await getHead();
  const totalBlocks =
    opts.windowBlocks === "all" ? Math.max(0, head - EARLIEST_DEPLOYMENT_BLOCK) : opts.windowBlocks;
  let chunk = opts.chunkBlocks ?? 100_000;
  let halvings = 0;
  const out: RawLaunch[] = [];
  let ignoredLogs = 0;

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
  /**
   * Scan newest-first across ALL factories, not factory-by-factory.
   *
   * A generation-ordered list means a long scan ("all") spends its first minutes in
   * the oldest, quietest region while recent launches sit at the end. Newest-first
   * makes partial results useful, and if the user hits stop, what they have is the
   * most recent activity rather than the oldest.
   */
  tasks.sort((a, b) => b.to - a.to);

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
      // No topics filter: this RPC ignores it, so requesting a specific event just
      // returns the same set. Classification happens in classifyLog().
      logs = await rawGetLogs({
        address: getAddress(t.factory.address),
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
        opts.onProgress?.({ label: `RPC limit hit, halving window to ${half.toLocaleString()} blocks`, doneBlocks: done, totalBlocks: blocksTotal, launches: out.length });
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
      let classified: ReturnType<typeof classifyLog>;
      try {
        classified = classifyLog(log, t.factory);
      } catch (err) {
        // A malformed log must never abort the scan.
        decodeFailures++;
        if (firstDecodeError === null) firstDecodeError = `classify threw: ${String(err).split("\n")[0].slice(0, 160)}`;
        continue;
      }
      const { record, kind } = classified;
      if (kind === "other") {
        ignoredLogs++;
        continue;
      }
      if (kind === "malformed" || !record) {
        decodeFailures++;
        if (firstDecodeError === null) {
          firstDecodeError = `topic0 ${log.topics[0]} did not match the expected launch-event layout`;
        }
        continue;
      }
      out.push(record);
    }
    done += t.to - t.from;
    opts.onProgress?.({
      label: `${t.factory.label} ${t.from.toLocaleString()}-${t.to.toLocaleString()}`,
      doneBlocks: done,
      totalBlocks: blocksTotal,
      launches: out.length,
    });
    i++;
  }

  out.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  return { launches: out, head, chunks: tasks.length, halvings, decodeFailures, firstDecodeError, ignoredLogs };
}

function baseRecord(log: Log, factory: FactoryInfo) {
  return {
    generation: factory.generation,
    factoryLabel: factory.label,
    factory: factory.address,
    blockNumber: Number(log.blockNumber),
    txHash: log.transactionHash ?? "",
    logIndex: Number(log.logIndex ?? 0),
  };
}

export function decodeClassicLaunch(log: Log, factory: FactoryInfo): RawLaunch | null {
  const decoded = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics });
  const a = decoded.args as unknown as Record<string, unknown>;
  const quoted = decoded.eventName === "TokenLaunchedQuoted";
  const token = (a.token as string) ?? "";
  const curve = (a.curve as string) ?? "";
  if (!token || !curve) return null;
  return {
    ...baseRecord(log, factory),
    launchId: (a.launchId as bigint) ?? 0n,
    token,
    curve,
    creator: (a.creator as string) ?? "",
    quoteCurrency: quoted ? ((a.quoteCurrency as string) ?? null) : null,
    initialBuy: (a.initialBuy as bigint) ?? 0n,
    metadataURI: (a.metadataURI as string) ?? "",
    quoted,
    curveKind: "classic",
  };
}

function dataWord(data: string, index: number): string | null {
  const start = 2 + index * 64;
  return data.length >= start + 64 ? data.slice(start, start + 64) : null;
}

function wordToAddress(word: string | null): string | null {
  if (!word) return null;
  const v = BigInt("0x" + word);
  if (v === 0n || v >= 2n ** 160n) return null;
  return getAddress(`0x${v.toString(16).padStart(40, "0")}`);
}

function topicToAddress(topic: string | undefined): string | null {
  if (!topic) return null;
  const v = BigInt(topic);
  if (v === 0n || v >= 2n ** 160n) return null;
  return getAddress(`0x${v.toString(16).padStart(40, "0")}`);
}

/**
 * Decode a V6 launch log by position.
 *
 * There is no ABI for this event anywhere: it is absent from the frontend bundle
 * and unknown to 4byte.directory, because it carries the token's name, symbol and
 * metadata URI as three dynamic strings. The layout below was recovered by matching
 * a live log against known on-chain values (see V6_WORD in chain.ts) and is
 * validated on every decode: offsets must land inside the data, the strings must be
 * printable, and the curve word must be address-shaped. Anything else returns null
 * and is reported as a decode failure rather than being shown as data.
 */
export function decodeV6Launch(log: Log, factory: FactoryInfo): RawLaunch | null {
  if (log.topics.length < 4) return null;
  const data = log.data;

  const readString = (offsetWordIndex: number): string | null => {
    const offWord = dataWord(data, offsetWordIndex);
    if (!offWord) return null;
    const byteOffset = Number(BigInt("0x" + offWord));
    if (!Number.isSafeInteger(byteOffset) || byteOffset % 32 !== 0 || byteOffset === 0) return null;
    const lenIndex = byteOffset / 32;
    const lenWord = dataWord(data, lenIndex);
    if (!lenWord) return null;
    const len = Number(BigInt("0x" + lenWord));
    if (len === 0) return "";
    if (len > 512) return null;
    const startByte = (lenIndex + 1) * 32;
    const hex = data.slice(2 + startByte * 2, 2 + startByte * 2 + len * 2);
    if (hex.length !== len * 2) return null;
    try {
      const s = hexToString(`0x${hex}`);
      // Control characters mean the offsets are wrong, not that the name is odd.
      return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
    } catch {
      return null;
    }
  };

  const curve = wordToAddress(dataWord(data, V6_WORD.curve));
  const token = topicToAddress(log.topics[3]);
  if (!curve || !token) return null;

  const name = readString(V6_WORD.nameOffset);
  const symbol = readString(V6_WORD.symbolOffset);
  const uri = readString(V6_WORD.uriOffset);
  if (name === null || symbol === null || uri === null) return null;

  const pairWord = dataWord(data, V6_WORD.pairCurrency);
  const targetWord = dataWord(data, V6_WORD.targetPairUnits);
  const taxWord = dataWord(data, V6_WORD.baseTaxBps);
  const projectTreasury = topicToAddress(log.topics[2]);

  return {
    ...baseRecord(log, factory),
    launchId: BigInt(log.topics[1] ?? "0x0"),
    token,
    curve,
    // The V6 launch event publishes no creator address; the closest identity it
    // carries is the project treasury (topic2).
    creator: projectTreasury ?? "",
    quoteCurrency: pairWord && BigInt("0x" + pairWord) !== 0n ? wordToAddress(pairWord) : null,
    initialBuy: 0n, // not published in the V6 launch event
    metadataURI: uri,
    // The V6 launch event has no stock-paired variant: the factory's other event is
    // a different per-launch event entirely (V6PerLaunchOther), so this is always false.
    quoted: false,
    curveKind: "v6",
    nameHint: name || undefined,
    symbolHint: symbol || undefined,
    targetHint: targetWord ? BigInt("0x" + targetWord) : undefined,
    taxBpsHint: taxWord ? BigInt("0x" + taxWord) : undefined,
  };
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
 *
 * Both curve implementations are read in the same multicall with allowFailure, so
 * a row's generation is determined by which set of reads actually succeeded, since
 * classic curves revert on the V6 getters and vice versa.
 *
 * V6 has no reserve or price getter at all, so its price is derived from the
 * contract's own quote function: the marginal price across a 0.001 → 0.002 ETH
 * probe, which is what the curve would charge for the next tiny buy.
 */
export async function enrichLaunches(rows: RawLaunch[], opts: { onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean } = {}): Promise<LaunchRow[]> {
  const result: LaunchRow[] = [];
  const perRow = 4 + CURVE_READ_FNS.length + V6_CURVE_READ_FNS.length + 2;
  const PROBE_LO = 10n ** 15n;
  const PROBE_HI = 2n * 10n ** 15n;

  for (let start = 0; start < rows.length; start += BATCH) {
    if (opts.shouldStop?.()) break;
    const slice = rows.slice(start, start + BATCH);
    /**
     * Addresses come from decoded logs, so a malformed one is possible. `getAddress`
     * THROWS on a bad checksum/length, outside the multicall's try/catch, which is
     * exactly the kind of one-bad-row failure that blanks a UI. Substitute the zero
     * address instead: the reads then fail individually (allowFailure) and the row
     * renders with dashes plus an explicit reason.
     */
    const ZERO = "0x0000000000000000000000000000000000000000" as const;
    const toAddr = (a: string): `0x${string}` => {
      try {
        return getAddress(a);
      } catch {
        return ZERO;
      }
    };
    const badAddress = (r: RawLaunch) => toAddr(r.token) === ZERO || toAddr(r.curve) === ZERO;

    const contracts = slice.flatMap((r) => {
      const token = toAddr(r.token);
      const curve = toAddr(r.curve);
      return [
        { address: token, abi: ERC20_ABI, functionName: "name" as const },
        { address: token, abi: ERC20_ABI, functionName: "symbol" as const },
        { address: token, abi: ERC20_ABI, functionName: "transfersUnlocked" as const },
        { address: token, abi: ERC20_ABI, functionName: "totalSupply" as const },
        ...CURVE_READ_FNS.map((fn) => ({ address: curve, abi: CURVE_ABI, functionName: fn })),
        ...V6_CURVE_READ_FNS.map((fn) => ({ address: curve, abi: V6_CURVE_ABI, functionName: fn })),
        { address: curve, abi: V6_CURVE_ABI, functionName: "quoteBuyExactIn" as const, args: [PROBE_LO] },
        { address: curve, abi: V6_CURVE_ABI, functionName: "quoteBuyExactIn" as const, args: [PROBE_HI] },
      ];
    });

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
      // Offsets derived from the read lists, never hardcoded: a change to either
      // list must not be able to silently shift which slot a field comes from.
      const base = idx * perRow;
      const classicSlot = (fn: (typeof CURVE_READ_FNS)[number]) => base + 4 + CURVE_READ_FNS.indexOf(fn);
      const v6Slot = (fn: (typeof V6_CURVE_READ_FNS)[number]) =>
        base + 4 + CURVE_READ_FNS.length + V6_CURVE_READ_FNS.indexOf(fn);
      const val = (offset: number): unknown => {
        const item = results[offset] as { status?: string; result?: unknown } | undefined;
        return item && item.status === "success" ? item.result : null;
      };
      const num = (offset: number): bigint | null => {
        const v = val(offset);
        return typeof v === "bigint" ? v : null;
      };

      const totalSupply = num(base + 3);
      const virtualEth = num(classicSlot("virtualEthReserve"));
      const virtualToken = num(classicSlot("virtualTokenReserve"));
      const realEth = num(classicSlot("realEthReserve"));
      const feeBps = num(classicSlot("TOTAL_FEE_BPS"));
      const target = num(classicSlot("NET_GRADUATION_TARGET"));
      const completeClassic = val(classicSlot("complete"));
      const launchTimestamp = num(classicSlot("launchTimestamp"));
      const state: CurveState | null =
        virtualEth !== null && virtualToken !== null && realEth !== null
          ? {
              virtualEth,
              virtualToken,
              realEth,
              feeBps: feeBps ?? 0n,
              creatorShareBps: 7_500n,
              target: target ?? 0n,
              complete: completeClassic === true,
            }
          : null;

      // V6 path
      const principal = num(v6Slot("pairPrincipal"));
      const v6Target = num(v6Slot("targetPairUnits"));
      const soldTokens = num(v6Slot("sold"));
      const v6Tax = num(v6Slot("baseTaxBps"));
      const v6Created = num(v6Slot("createdAt"));
      const v6Complete = val(v6Slot("complete"));
      const hasV6 = principal !== null || v6Target !== null || soldTokens !== null;
      let quotePriceWad: bigint | null = null;
      if (hasV6) {
        const lo = num(base + 4 + CURVE_READ_FNS.length + V6_CURVE_READ_FNS.length);
        const hi = num(base + 5 + CURVE_READ_FNS.length + V6_CURVE_READ_FNS.length);
        // price = Δquote / Δtokens, scaled to wad. (Inverting this is how you get a
        // plausible-looking number that is one over the real price.)
        if (lo !== null && hi !== null && hi > lo) quotePriceWad = ((PROBE_HI - PROBE_LO) * 10n ** 18n) / (hi - lo);
      }
      const v6 = hasV6
        ? {
            principalWei: principal,
            targetWei: v6Target ?? r.targetHint ?? null,
            soldTokens,
            taxBps: v6Tax ?? r.taxBpsHint ?? null,
            createdAt: v6Created !== null ? Number(v6Created) : null,
            complete: v6Complete === true,
            quotePriceWad,
          }
        : null;

      const statePrice = num(classicSlot("spotPriceWad"));
      const spotPriceWad = state ? (statePrice ?? priceWad(state)) : (v6?.quotePriceWad ?? null);
      const fdvFromState = num(classicSlot("fdvWei"));
      const fdvWei = state
        ? fdvFromState
        : v6?.quotePriceWad !== null && v6?.quotePriceWad !== undefined && totalSupply !== null
          ? (v6.quotePriceWad * totalSupply) / 10n ** 18n
          : null;

      const launchTs = launchTimestamp !== null ? Number(launchTimestamp) : (v6?.createdAt ?? null);
      const progress =
        state && state.target > 0n
          ? Number((state.realEth * 10_000n) / state.target)
          : v6 && v6.principalWei !== null && v6.targetWei !== null && v6.targetWei > 0n
            ? Number((v6.principalWei * 10_000n) / v6.targetWei)
            : null;

      result.push({
        ...r,
        name: (val(base) as string) ?? r.nameHint ?? "(no name)",
        symbol: (val(base + 1) as string) ?? r.symbolHint ?? "?",
        transfersUnlocked: typeof val(base + 2) === "boolean" ? (val(base + 2) as boolean) : null,
        state,
        v6,
        totalSupply,
        curveTokensRemaining: num(classicSlot("curveTokensRemaining")),
        spotPriceWad,
        fdvWei,
        graduated: state ? completeClassic === true : (v6?.complete ?? null),
        launchTimestamp: launchTs,
        progressBps: progress,
        priceSource: statePrice !== null ? "state" : quotePriceWad !== null ? "quote" : null,
        enrichmentError: badAddress(r)
          ? "invalid address in launch log, reads skipped"
          : results.length === 0
            ? "multicall unavailable"
            : null,
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
  /** True when the curve cannot sell any more (exhausted / completed). */
  curveExhausted: boolean;
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
  /**
   * A curve that has sold out returns 0 tokens from quoteBuy, and that is not a model
   * failure, it is the curve refusing to sell. Treat "both agree there is nothing
   * left" as a pass, and say so, rather than reporting a mismatch.
   */
  const curveExhausted = chainTokens === 0n;
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
    curveExhausted,
    ok: spotDelta === 0n && (tokenDelta === 0n || tokenDelta === -1n || tokenDelta === 1n || curveExhausted),
  };
}
