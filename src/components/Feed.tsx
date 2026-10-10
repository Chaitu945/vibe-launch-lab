import { useCallback, useMemo, useRef, useState } from "react";
import type React from "react";
import { BLOCK_SECONDS, blocksForHours, CHAIN, EARLIEST_DEPLOYMENT_BLOCK } from "../lib/chain";
import { activityBuckets, enrichLaunches, rowLaunchTimestamp, rowProgressBps, rowRaised, scanLaunches, type LaunchRow, type RawLaunch, type ScanProgress } from "../lib/scan";
import { fetchMetadata, mapLimit, type ProjectMetadata } from "../lib/metadata";
import { agoFromUnix, duration, fmtEth, fmtInt, fmtPrice, fmtPriceFull, pct, short } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { Leaderboard } from "./Leaderboard";
import { ActivityStrip } from "./ActivityStrip";
import { TokenDetail } from "./TokenDetail";

const BLOCKS_PER_HOUR = Math.round(3600 / BLOCK_SECONDS);
const PAGE = 24;

/**
 * Windows are expressed in HOURS and converted at the measured block time, so the
 * labels mean what they say. (They used to be round block counts labelled after
 * the fact, which is why there was a stray "~17 hours".)
 */
const WINDOWS: { label: string; hours: number | null }[] = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "all (since the first factory)", hours: null },
];

const windowBlocksFor = (hours: number | null): number | "all" =>
  hours === null ? "all" : blocksForHours(hours);

type SortKey = "newest" | "progress" | "raised" | "fdv" | "initialBuy";

/** Progress tags: decoration on top of a real number, never a substitute for it. */
function rowTag(r: LaunchRow) {
  const ts = rowLaunchTimestamp(r);
  const ageSeconds = ts ? Math.floor(Date.now() / 1000) - ts : null;
  // A launch minutes old is the interesting thing on screen, so it gets the loudest tag.
  if (ageSeconds !== null && ageSeconds < 300) return <span className="tag new">new</span>;
  if (r.graduated) return <span className="tag done">graduated</span>;
  const p = rowProgressBps(r);
  if (p !== null && p >= 9000) return <span className="tag hot">🔥 nearly graduating</span>;
  if (p !== null && p >= 5000) return <span className="tag">halfway</span>;
  return null;
}

export function Feed() {
  const [windowHours, setWindowHours] = useState<number | null>(24);
  const [blocksScanned, setBlocksScanned] = useState<number | null>(null);
  const [justScanned, setJustScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodeWarn, setDecodeWarn] = useState<string | null>(null);
  const [capWarn, setCapWarn] = useState<string | null>(null);
  const [ignored, setIgnored] = useState(0);
  const [halvings, setHalvings] = useState(0);
  const [head, setHead] = useState<number | null>(null);
  const [raw, setRaw] = useState<RawLaunch[]>([]);
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const [meta, setMeta] = useState<Record<string, ProjectMetadata | null>>({});
  const [selected, setSelected] = useState<LaunchRow | null>(null);
  const [query, setQuery] = useState("");
  const [genFilter, setGenFilter] = useState<"all" | "retired" | "legacy" | "current">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "on-curve" | "graduated" | "nearly">("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const stopRef = useRef(false);

  const loadMetadata = useCallback(async (list: LaunchRow[]) => {
    const next: Record<string, ProjectMetadata | null> = {};
    await mapLimit(list, 4, async (row) => {
      if (!row.metadataURI) {
        next[row.curve] = null;
        return null;
      }
      next[row.curve] = await fetchMetadata(row.metadataURI);
      return null;
    });
    setMeta((prev) => ({ ...prev, ...next }));
  }, []);

  const run = useCallback(async () => {
    stopRef.current = false;
    setBusy(true);
    setError(null);
    setRows([]);
    setRaw([]);
    setMeta({});
    setSelected(null);
    setStage("sniffing factory logs");
    try {
      const res = await scanLaunches({
        windowBlocks: windowBlocksFor(windowHours),
        onProgress: (p) => setProgress(p),
        shouldStop: () => stopRef.current,
      });
      setBlocksScanned(
        windowHours === null ? Math.max(0, res.head - EARLIEST_DEPLOYMENT_BLOCK) : blocksForHours(windowHours),
      );
      setHead(res.head);
      setRaw(res.launches);
      setDecodeWarn(
        res.decodeFailures > 0 ? `${res.decodeFailures} log(s) failed to decode: ${res.firstDecodeError ?? "unknown error"}` : null,
      );
      setIgnored(res.ignoredLogs);
      setHalvings(res.halvings);
      setCapWarn(
        res.truncated
          ? `stopped after ${fmtInt(res.launches.length)} launches, keeping the newest. A window this wide has more history than the page should hold, so narrow it for full coverage.`
          : null,
      );
      setStage(`found ${fmtInt(res.launches.length)} launches: reading their curves…`);
      const page = res.launches.slice(0, PAGE);
      const enriched = await enrichLaunches(page, { onProgress: () => undefined, shouldStop: () => stopRef.current });
      setRows(enriched);
      setScannedAt(Date.now());
      setStage("asking IPFS for logos and blurbs…");
      await loadMetadata(enriched);
      setStage(null);
      setJustScanned(true);
    } catch (e) {
      setError(String(e).slice(0, 300));
      setStage(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [windowHours, loadMetadata]);

  const loadMore = useCallback(async () => {
    const already = rows.length;
    const nextRaw = raw.slice(already, already + PAGE);
    if (nextRaw.length === 0) return;
    setStage(`reading ${nextRaw.length} more`);
    try {
      const enriched = await enrichLaunches(nextRaw, {});
      setRows((prev) => [...prev, ...enriched]);
      setStage(null);
      await loadMetadata(enriched);
    } catch (e) {
      setStage(null);
      setError(`loading more rows failed: ${String(e).slice(0, 200)}`);
    }
  }, [raw, rows.length, loadMetadata]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => !r.graduated).length;
    const graduated = rows.filter((r) => r.graduated).length;
    const raised = rows.reduce((a, r) => a + (rowRaised(r) ?? 0n), 0n);
    const initial = rows.reduce((a, r) => a + r.initialBuy, 0n);
    const withTarget = rows.filter((r) => rowProgressBps(r) !== null);
    const avgProgress = withTarget.length
      ? withTarget.reduce((a, r) => a + (rowProgressBps(r) ?? 0), 0) / withTarget.length
      : null;
    return { active, graduated, raised, initial, avgProgress, total: rows.length };
  }, [rows]);

  const buckets = useMemo(() => {
    if (head === null) return [];
    const hours = Math.min(48, Math.max(6, Math.round((blocksScanned ?? BLOCKS_PER_HOUR) / BLOCKS_PER_HOUR)));
    return activityBuckets(raw, head, hours, BLOCKS_PER_HOUR);
  }, [raw, head, blocksScanned]);

  const visible = useMemo(() => {
    let list = rows;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.symbol.toLowerCase().includes(q) ||
          r.creator.toLowerCase().includes(q) ||
          r.token.toLowerCase().includes(q),
      );
    }
    if (genFilter !== "all") list = list.filter((r) => r.generation === genFilter);
    if (statusFilter === "on-curve") list = list.filter((r) => !r.graduated);
    if (statusFilter === "graduated") list = list.filter((r) => r.graduated);
    if (statusFilter === "nearly")
      list = list.filter((r) => !r.graduated && (rowProgressBps(r) ?? 0) >= 9000);
    const sorted = [...list];
    switch (sort) {
      case "progress":
        sorted.sort((a, b) => (rowProgressBps(b) ?? -1) - (rowProgressBps(a) ?? -1));
        break;
      case "raised":
        sorted.sort((a, b) => Number((rowRaised(b) ?? 0n) - (rowRaised(a) ?? 0n)));
        break;
      case "fdv":
        sorted.sort((a, b) => Number((b.fdvWei ?? 0n) - (a.fdvWei ?? 0n)));
        break;
      case "initialBuy":
        sorted.sort((a, b) => Number(b.initialBuy - a.initialBuy));
        break;
      default:
        sorted.sort((a, b) => b.blockNumber - a.blockNumber);
    }
    return sorted;
  }, [rows, query, genFilter, statusFilter, sort]);

  return (
    <div className="feed">
      <div className="controls">
        <label>
          window
          <select
            value={windowHours === null ? "all" : String(windowHours)}
            onChange={(e) => setWindowHours(e.target.value === "all" ? null : Number(e.target.value))}
            disabled={busy}
          >
            {WINDOWS.map((w) => (
              <option key={w.label} value={w.hours === null ? "all" : String(w.hours)}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "working…" : "scan launches"}
        </button>
        {busy && (
          <button className="ghost" onClick={() => (stopRef.current = true)}>
            stop
          </button>
        )}
        <div className="spacer" />
        {head !== null && (
          <div className="muted small">
            head {fmtInt(head)} · {duration((Date.now() - (scannedAt ?? Date.now())) / 1000)} ago
          </div>
        )}
      </div>

      {windowHours === null && (
        <p className="muted small">
          "all" scans back to the first factory deployment
          {head ? `, about ${fmtInt(Math.round((head - EARLIEST_DEPLOYMENT_BLOCK) / 1000))}k blocks from here` : ""}. Expect
          minutes of RPC calls and tens of thousands of launches; rows are enriched 24 at a time and the activity strip only
          charts the most recent 48 hours.
        </p>
      )}

      {stage && (
        <div className="progress">
          <div className="progress-label">
            {stage}
            {progress ? ` · ${Math.min(100, Math.round((progress.doneBlocks / progress.totalBlocks) * 100))}%` : ""}
            {progress ? ` · ${fmtInt(progress.launches)} found` : ""}
            {progress?.etaSeconds ? ` · about ${duration(progress.etaSeconds)} left` : ""}
          </div>
          {progress && (
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.min(100, (progress.doneBlocks / progress.totalBlocks) * 100).toFixed(1)}%` }} />
            </div>
          )}
          {/*
            Raw block ranges and chunk arithmetic are diagnostics, not interface. They live
            behind a disclosure so the default view reads as English, and anyone debugging a
            scan can still see exactly which slice is in flight.
          */}
          {progress && (
            <details className="progress-detail">
              <summary>scan detail</summary>
              <p className="muted small mono">
                {progress.label} · {fmtInt(progress.doneBlocks)} of {fmtInt(progress.totalBlocks)} blocks
                {halvings > 0 ? ` · chunk halved ${halvings}x after an RPC limit` : ""}
              </p>
            </details>
          )}
        </div>
      )}
      {error && <p className="error">RPC error: {error}</p>}
      {capWarn && <p className="error">{capWarn}</p>}
      {decodeWarn && <p className="error">decode warning: {decodeWarn}</p>}
      {!decodeWarn && ignored > 0 && (
        <p className="muted small">
          {fmtInt(ignored)} other protocol event(s) ignored: this RPC ignores event filters, so every log from a factory is
          classified client-side and non-launch events are counted here rather than treated as errors.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className={"stats" + (justScanned ? " pop" : "")} key={scannedAt ?? 0}>
            <div className="stat">
              <span>launches found</span>
              <b>{fmtInt(raw.length)}</b>
            </div>
            <div className="stat" title="Rows whose curve and token contract were actually read on-chain. The rest show dashes until you load more.">
              <span>with live numbers</span>
              <b>{fmtInt(stats.total)}</b>
            </div>
            <div className="stat" title="Of the rows read so far, how many are still on a curve vs already graduated.">
              <span>on curve / graduated</span>
              <b>
                {stats.active} / {stats.graduated}
              </b>
            </div>
            <div className="stat" title="ETH collected across the curves read so far. Read from each curve contract, not estimated.">
              <span>raised across those</span>
              <b>{fmtEth(stats.raised, 3)} ETH</b>
            </div>
            <div className="stat" title="Total ETH creators spent buying their own token at launch.">
              <span>creator opening buys</span>
              <b>{fmtEth(stats.initial, 3)} ETH</b>
            </div>
            <div className="stat" title="Mean progress to graduation (raised ÷ target) across the rows read.">
              <span>avg progress</span>
              <b>{pct(stats.avgProgress === null ? null : Math.round(stats.avgProgress))}</b>
            </div>
          </div>

          {buckets.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <b>Launch activity per hour</b>
                <span className="muted small">bursts, not a steady stream, which is why the feed scans windows rather than a fixed range</span>
              </div>
              <ActivityStrip buckets={buckets} />
            </div>
          )}

          {rows.length > 0 && <Leaderboard rows={rows} meta={meta} onSelect={setSelected} />}

          <div className="chips">
            {(
              [
                ["all", "everything"],
                ["on-curve", "on curve"],
                ["nearly", "🔥 nearly graduating"],
                ["graduated", "graduated"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={"chip" + (statusFilter === value ? " on" : "")}
                onClick={() => setStatusFilter(value)}
                disabled={busy}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="filters">
            <input placeholder="search name, symbol, creator, address" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={genFilter} onChange={(e) => setGenFilter(e.target.value as typeof genFilter)}>
              <option value="all">all generations</option>
              <option value="current">gen3 (current)</option>
              <option value="legacy">gen2 (legacy)</option>
              <option value="retired">gen1 (retired)</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">any status</option>
              <option value="on-curve">on curve</option>
              <option value="nearly">nearly graduating</option>
              <option value="graduated">graduated</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="newest">newest</option>
              <option value="progress">progress</option>
              <option value="raised">raised</option>
              <option value="fdv">FDV</option>
              <option value="initialBuy">opening buy</option>
            </select>
          </div>

          <div className="table">
            <div className="tr th">
              <span title="Name and symbol are read from the token contract; the logo comes from IPFS metadata.">project</span>
              <span title="Which factory generation emitted this launch.">gen</span>
              <span title="How long ago the launch transaction happened.">age</span>
              <span className="num" title="ETH the creator spent buying their own token at launch.">
                opening buy
              </span>
              <span className="num" title="ETH collected on the curve so far, read from the curve contract.">
                raised
              </span>
              <span className="num" title="raised divided by the ETH target needed to graduate.">
                progress
              </span>
              <span className="num" title="Quote per token, read from the curve. Hover a price for the exact decimal.">
                price
              </span>
              <span className="num" title="price x the 1,000,000,000 token supply.">
                FDV
              </span>
              <span title="The wallet that launched it.">creator</span>
            </div>
            {visible.map((r, i) => (
              <button
                className="tr clickable"
                key={`${r.curve}-${r.launchId}`}
                style={{ "--i": Math.min(i, 24) } as React.CSSProperties}
                onClick={() => setSelected(r)}
              >
                <span className="project">
                  <TokenAvatar name={r.name} imageUri={meta[r.curve]?.image} />
                  <span className="names">
                    <b>
                      {r.name}
                      {rowTag(r)}
                    </b>
                    <small>
                      {r.symbol}
                      {r.quoted ? " · stock pair" : ""}
                    </small>
                  </span>
                </span>
                <span>
                  <span className={`badge ${r.generation}`}>{r.factoryLabel}</span>
                </span>
                <span className="muted small">{rowLaunchTimestamp(r) ? agoFromUnix(rowLaunchTimestamp(r)!) : "-"}</span>
                <span className="num">{fmtEth(r.initialBuy, 3)}</span>
                <span className="num">{fmtEth(rowRaised(r), 3)}</span>
                <span className="num">
                  <span className="progress-cell">
                    <span className="mini-bar">
                      <span className="mini-fill" style={{ width: `${Math.min(100, (rowProgressBps(r) ?? 0) / 100)}%` }} />
                    </span>
                    {pct(rowProgressBps(r), 0)}
                  </span>
                </span>
                <span className="num" title={`exact: ${fmtPriceFull(r.spotPriceWad)}`}>{fmtPrice(r.spotPriceWad)}</span>
                <span className="num" title={`exact: ${fmtEth(r.fdvWei, 6)} ETH`}>{fmtEth(r.fdvWei, 2)}</span>
                <span className="muted small mono">{short(r.creator)}</span>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="empty">
                nothing matches that. loosen a filter, or widen the window. the pad is quiet sometimes 🌵
              </div>
            )}
          </div>

          <p className="muted small legend">
            reading the numbers: <b>0.₈1464</b> means 0.000000001464. The small subscript counts the zeros after the decimal
            point, which beats both a wall of zeros and an exponent. Hover any number for its exact value. <b>raised</b> is ETH
            collected on the curve, <b>progress</b> is raised ÷ target, <b>FDV</b> is price × the 1B supply, and <b>stock pair</b>{" "}
            means the token trades against a stock token instead of ETH.
          </p>

          {rows.length < raw.length && (
            <button className="primary" onClick={loadMore} disabled={busy}>
              load {Math.min(PAGE, raw.length - rows.length)} more (of {fmtInt(raw.length - rows.length)} scanned)
            </button>
          )}
        </>
      )}

      {rows.length === 0 && !busy && (
        <p className="muted">
          {scannedAt !== null
            ? "no launches in that window. the pad is quiet right now. try a wider window (12 hours, then 1 day, then 7 days)."
            : `Pick a window and hit scan. Launch events are read straight off Robinhood Chain Testnet (${CHAIN.rpc.replace("https://", "")}): no indexer, no API key, nothing hidden.`}
        </p>
      )}

      {selected && <TokenDetail row={selected} metadata={meta[selected.curve]} onClose={() => setSelected(null)} />}
    </div>
  );
}
