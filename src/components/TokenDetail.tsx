import { useState } from "react";
import { CHAIN } from "../lib/chain";
import { fmtEth, fmtPrice, fmtTokens, pct, short, agoFromUnix } from "../lib/format";
import { verifyCurve, type LaunchRow, type VerificationResult } from "../lib/scan";
import type { ProjectMetadata } from "../lib/metadata";
import { TokenAvatar } from "./TokenAvatar";

interface Props {
  row: LaunchRow;
  metadata: ProjectMetadata | null | undefined;
  onClose: () => void;
}

export function TokenDetail({ row, metadata, onClose }: Props) {
  const [check, setCheck] = useState<VerificationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(await verifyCurve(row.curve));
    } catch (e) {
      setCheckError(String(e).slice(0, 180));
    } finally {
      setChecking(false);
    }
  };

  const s = row.state;
  return (
    <aside className="detail">
      <div className="detail-head">
        <TokenAvatar name={row.name} imageUri={metadata?.image} size={44} />
        <div>
          <div className="detail-title">
            {row.name} <span className="sym">{row.symbol}</span>
          </div>
          <div className="muted small">
            {row.factoryLabel} · launch #{row.launchId.toString()} · {row.blockNumber.toLocaleString()}
            {row.launchTimestamp ? ` · ${agoFromUnix(row.launchTimestamp)} ago` : ""}
          </div>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {metadata?.description && <p className="detail-desc">{metadata.description}</p>}
      {(metadata?.twitter || metadata?.website || metadata?.telegram) && (
        <div className="link-row">
          {metadata?.website && (
            <a href={metadata.website} target="_blank" rel="noreferrer noopener">
              website
            </a>
          )}
          {metadata?.twitter && (
            <a href={metadata.twitter} target="_blank" rel="noreferrer noopener">
              x
            </a>
          )}
          {metadata?.telegram && (
            <a href={metadata.telegram} target="_blank" rel="noreferrer noopener">
              telegram
            </a>
          )}
        </div>
      )}

      <div className="kv">
        <div>
          <span>Raised on curve</span>
          <b>{fmtEth(s?.realEth)} ETH</b>
        </div>
        <div>
          <span>Graduation target</span>
          <b>{s && s.target > 0n ? `${fmtEth(s.target)} ETH` : "unverified"}</b>
        </div>
        <div>
          <span>Progress</span>
          <b>{pct(row.progressBps)}</b>
        </div>
        <div>
          <span>Spot price</span>
          <b>{fmtPrice(row.spotPriceWad)} ETH</b>
        </div>
        <div>
          <span>FDV</span>
          <b>{fmtEth(row.fdvWei, 3)} ETH</b>
        </div>
        <div>
          <span>Tokens sold</span>
          <b>{fmtTokens(s ? s.virtualToken : null)}</b>
        </div>
        <div>
          <span>Creator opening buy</span>
          <b>{fmtEth(row.initialBuy)} ETH</b>
        </div>
        <div>
          <span>Status</span>
          <b>{row.graduated ? "graduated / complete" : "on curve"}</b>
        </div>
      </div>

      <div className="addr-list">
        <div>
          <span>token</span>
          <a href={`${CHAIN.explorer}/token/${row.token}`} target="_blank" rel="noreferrer noopener">
            {row.token}
          </a>
        </div>
        <div>
          <span>curve</span>
          <a href={`${CHAIN.explorer}/address/${row.curve}`} target="_blank" rel="noreferrer noopener">
            {row.curve}
          </a>
        </div>
        <div>
          <span>creator</span>
          <a href={`${CHAIN.explorer}/address/${row.creator}`} target="_blank" rel="noreferrer noopener">
            {row.creator}
          </a>
        </div>
        {row.quoteCurrency && (
          <div>
            <span>quote asset</span>
            <a href={`${CHAIN.explorer}/token/${row.quoteCurrency}`} target="_blank" rel="noreferrer noopener">
              {short(row.quoteCurrency, 6)}
            </a>
          </div>
        )}
      </div>

      <div className="verify-block">
        <div className="verify-head">
          <b>Model vs contract</b>
          <button className="ghost small" onClick={runCheck} disabled={checking}>
            {checking ? "checking…" : "run check"}
          </button>
        </div>
        <p className="muted small">
          Reads this curve's own <code>spotPriceWad()</code> and <code>quoteBuy(0.01 ETH)</code> and compares them with the
          simulator's math.
        </p>
        {checkError && <p className="error small">{checkError}</p>}
        {check && (
          <div className="verify-result">
            <div className="row">
              <span>price</span>
              <b>{check.spotDeltaWei === 0n ? "exact match" : `off by ${check.spotDeltaWei.toString()} wei`}</b>
            </div>
            <div className="row">
              <span>0.01 ETH buy → tokens</span>
              <b>{check.tokenDelta.toString()} wei ({fmtTokens(check.chainTokens, 1)} from chain)</b>
            </div>
            <div className={`row verdict ${check.ok ? "ok" : "bad"}`}>
              <span>verdict</span>
              <b>{check.ok ? "model reproduces the contract" : "MISMATCH — do not trust simulator"}</b>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
