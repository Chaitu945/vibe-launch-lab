import { useMemo } from "react";
import { rowProgressBps, rowRaised, type LaunchRow } from "../lib/scan";
import { fmtEth, fmtInt, pct } from "../lib/format";
import type { ProjectMetadata } from "../lib/metadata";
import { TokenAvatar } from "./TokenAvatar";

interface Props {
  rows: LaunchRow[];
  meta: Record<string, ProjectMetadata | null | undefined>;
  onSelect: (row: LaunchRow) => void;
}

/**
 * The two questions a person actually opens this app with: what is raising money, and what
 * is about to graduate. Both are derived from the rows already read, so this costs no extra
 * network work, and it says which rows it is ranking rather than implying the whole chain.
 */
export function Leaderboard({ rows, meta, onSelect }: Props) {
  const byRaised = useMemo(
    () => [...rows].sort((a, b) => Number((rowRaised(b) ?? 0n) - (rowRaised(a) ?? 0n))).slice(0, 5),
    [rows],
  );
  const byProgress = useMemo(
    () =>
      [...rows]
        .filter((r) => !r.graduated)
        .sort((a, b) => (rowProgressBps(b) ?? -1) - (rowProgressBps(a) ?? -1))
        .slice(0, 5),
    [rows],
  );
  if (rows.length === 0) return null;

  const list = (
    title: string,
    entries: LaunchRow[],
    value: (r: LaunchRow) => string,
    tone: string,
  ) => (
    <div className="lb-col">
      <span className={"lb-title " + tone}>{title}</span>
      {entries.map((r, i) => (
        <button className="lb-row" key={`${title}-${r.curve}-${r.launchId}`} onClick={() => onSelect(r)}>
          <span className="lb-rank">{i + 1}</span>
          <TokenAvatar name={r.name} imageUri={meta[r.curve]?.image} size={26} />
          <span className="lb-name">
            <b>{r.name}</b>
            <small className="mono">{r.symbol}</small>
          </span>
          <span className="lb-value num">{value(r)}</span>
        </button>
      ))}
      {entries.length === 0 && <p className="muted small">nothing to rank yet</p>}
    </div>
  );

  return (
    <div className="panel leaderboard">
      <div className="panel-head">
        <b>Standouts</b>
        <span className="muted small">
          ranked across the {fmtInt(rows.length)} rows read so far, not the whole chain. click one to open it.
        </span>
      </div>
      <div className="lb-grid">
        {list("biggest raises", byRaised, (r) => `${fmtEth(rowRaised(r), 3)} ETH`, "raise")}
        {list("closest to graduating", byProgress, (r) => `${pct(rowProgressBps(r), 1)} to target`, "grad")}
      </div>
    </div>
  );
}
