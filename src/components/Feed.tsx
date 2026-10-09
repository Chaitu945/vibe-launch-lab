import { useCallback, useMemo, useRef, useState } from "react";
import { BLOCK_SECONDS, CHAIN } from "../lib/chain";
import { activityBuckets, enrichLaunches, rowLaunchTimestamp, rowProgressBps, rowRaised, scanLaunches, type LaunchRow, type RawLaunch, type ScanProgress } from "../lib/scan";
import { fetchMetadata, mapLimit, type ProjectMetadata } from "../lib/metadata";
import { agoFromUnix, duration, fmtEth, fmtInt, fmtPrice, pct, short } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { ActivityStrip } from "./ActivityStrip";
import { TokenDetail } from "./TokenDetail";

const BLOCKS_PER_HOUR = Math.round(3600 / BLOCK_SECONDS);
const PAGE = 24;

const WINDOWS = [
  { label: "~1 hour", blocks: 25_000 },
  { label: "~4 hours", blocks: 100_000 },
  { label: "~17 hours", blocks: 400_000 },
  { label: "~3 days", blocks: 1_750_000 },
];

type SortKey = "newest" | "progress" | "raised" | "fdv" | "initialBuy";

export function Feed() {
  const [windowBlocks, setWindowBlocks] = useState(400_000);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodeWarn, setDecodeWarn] = useState<string | null>(null);
  const [ignored, setIgnored] = useState(0);
  const [head, setHead] = useState<number | null>(null);
  const [raw, setRaw] = useState<RawLaunch[]>([]);
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const [meta, setMeta] = useState<Record<string, ProjectMetadata | null>>({});
  const [selected, setSelected] = useState<LaunchRow | null>(null);
  const [query, setQuery] = useState("");
  const [genFilter, setGenFilter] = useState<"all" | "retired" | "legacy" | "current">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "on-curve" | "graduated">("all");
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
    setStage("scanning logs");
    try {
      const res = await scanLaunches({
        windowBlocks,
        onProgress: (p) => setProgress(p),
        shouldStop: () => stopRef.current,
      });
      setHead(res.head);
      setRaw(res.launches);
      setDecodeWarn(
        res.decodeFailures > 0 ? `${res.decodeFailures} log(s) failed to decode: ${res.firstDecodeError ?? "unknown error"}` : null,
      );
      setIgnored(res.ignoredLogs);
      setStage(`found ${fmtInt(res.launches.length)} launches — reading state`);
      const page = res.launches.slice(0, PAGE);
      const enriched = await enrichLaunches(page, { onProgress: () => undefined, shouldStop: () => stopRef.current });
      setRows(enriched);
      setScannedAt(Date.now());
      setStage("resolving IPFS metadata");
      await loadMetadata(enriched);
      setStage(null);
    } catch (e) {
      setError(String(e).slice(0, 300));
      setStage(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [windowBlocks, loadMetadata]);

  const loadMore = useCallback(async () => {
    const already = rows.length;
    const nextRaw = raw.slice(already, already + PAGE);
    if (nextRaw.length === 0) return;
    setStage(`reading ${nextRaw.length} more`);
    const enriched = await enrichLaunches(nextRaw, {});
    setRows((prev) => [...prev, ...enriched]);
    setStage(null);
    await loadMetadata(enriched);
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
    const hours = Math.min(48, Math.max(6, Math.round(windowBlocks / BLOCKS_PER_HOUR)));
    return activityBuckets(raw, head, hours, BLOCKS_PER_HOUR);
  }, [raw, head, windowBlocks]);

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
          <select value={windowBlocks} onChange={(e) => setWindowBlocks(Number(e.target.value))} disabled={busy}>
            {WINDOWS.map((w) => (
              <option key={w.blocks} value={w.blocks}>
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

      {stage && (
        <div className="progress">
          <div className="progress-label">
            {stage}
            {progress ? ` · ${progress.label}` : ""}
          </div>
          {progress && (
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.min(100, (progress.doneBlocks / progress.totalBlocks) * 100).toFixed(1)}%` }} />
            </div>
          )}
        </div>
      )}
      {error && <p className="error">RPC error: {error}</p>}
      {decodeWarn && <p className="error">decode warning — {decodeWarn}</p>}
      {!decodeWarn && ignored > 0 && (
        <p className="muted small">
          {fmtInt(ignored)} other protocol event(s) ignored — this RPC ignores event filters, so every log from a factory is
          classified client-side and non-launch events are counted here rather than treated as errors.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <span>launches found</span>
              <b>{fmtInt(raw.length)}</b>
            </div>
            <div className="stat">
              <span>enriched</span>
              <b>{fmtInt(stats.total)}</b>
            </div>
            <div className="stat">
              <span>on curve / graduated</span>
              <b>
                {stats.active} / {stats.graduated}
              </b>
            </div>
            <div className="stat">
              <span>raised (enriched)</span>
              <b>{fmtEth(stats.raised, 3)} ETH</b>
            </div>
            <div className="stat">
              <span>creator opening buys</span>
              <b>{fmtEth(stats.initial, 3)} ETH</b>
            </div>
            <div className="stat">
              <span>avg progress</span>
              <b>{pct(stats.avgProgress === null ? null : Math.round(stats.avgProgress))}</b>
            </div>
          </div>

          {buckets.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <b>Launch activity per hour</b>
                <span className="muted small">bursts, not a steady stream — this is why the feed scans windows, not a fixed range</span>
              </div>
              <ActivityStrip buckets={buckets} />
            </div>
          )}

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
              <span>project</span>
              <span>gen</span>
              <span>age</span>
              <span className="num">opening buy</span>
              <span className="num">raised</span>
              <span className="num">progress</span>
              <span className="num">price</span>
              <span className="num">FDV</span>
              <span>creator</span>
            </div>
            {visible.map((r) => (
              <button className="tr clickable" key={`${r.curve}-${r.launchId}`} onClick={() => setSelected(r)}>
                <span className="project">
                  <TokenAvatar name={r.name} imageUri={meta[r.curve]?.image} />
                  <span className="names">
                    <b>{r.name}</b>
                    <small>
                      {r.symbol}
                      {r.quoted ? " · stock pair" : ""}
                    </small>
                  </span>
                </span>
                <span>
                  <span className={`badge ${r.generation}`}>{r.factoryLabel}</span>
                </span>
                <span className="muted small">{rowLaunchTimestamp(r) ? agoFromUnix(rowLaunchTimestamp(r)!) : "—"}</span>
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
                <span className="num">{fmtPrice(r.spotPriceWad)}</span>
                <span className="num">{fmtEth(r.fdvWei, 2)}</span>
                <span className="muted small mono">{short(r.creator)}</span>
              </button>
            ))}
            {visible.length === 0 && <div className="empty">nothing matches these filters</div>}
          </div>

          {rows.length < raw.length && (
            <button className="primary" onClick={loadMore} disabled={busy}>
              load {Math.min(PAGE, raw.length - rows.length)} more (of {fmtInt(raw.length - rows.length)} scanned)
            </button>
          )}
        </>
      )}

      {rows.length === 0 && !busy && (
        <p className="muted">
          Pick a window and scan. Launches come off Robinhood Chain Testnet logs directly ({CHAIN.rpc.replace("https://", "")}) — no
          indexer, no API key.
        </p>
      )}

      {selected && <TokenDetail row={selected} metadata={meta[selected.curve]} onClose={() => setSelected(null)} />}
    </div>
  );
}
