import { useEffect, useMemo, useRef, useState } from "react";
import { CHAIN } from "../lib/chain";
import { fmtEth, fmtPrice, fmtPriceFull, fmtTokens, pct, short, agoFromUnix } from "../lib/format";
import { verifyCurve, rowLaunchTimestamp, rowProgressBps, rowRaised, rowTarget, rowTaxBps, rowTokensSold, type LaunchRow, type VerificationResult } from "../lib/scan";
import { sanitizeMetadata, socialHref, type ProjectMetadata } from "../lib/metadata";
import { TokenAvatar } from "./TokenAvatar";

interface Props {
  row: LaunchRow;
  metadata: ProjectMetadata | null | undefined;
  onClose: () => void;
}

export function TokenDetail({ row, metadata, onClose }: Props) {
  const asideRef = useRef<HTMLElement | null>(null);
  /**
   * React reuses this <aside> when a different row is clicked (same element type, same
   * position in the tree), so the previous token's scroll position carried over and the
   * panel could open part-way down its own content, over blank space. Start every token
   * at the top.
   */
  useEffect(() => {
    if (asideRef.current) asideRef.current.scrollTop = 0;
  }, [row.curve]);

  /**
   * Lock the page while the panel is open, and let Escape close it. Without the lock, a
   * wheel over the fixed panel chains to the feed behind it, which looks like the sidebar
   * scrolling through the tokens underneath.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("drawer-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.classList.remove("drawer-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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

  const raised = rowRaised(row);
  const target = rowTarget(row);
  const taxBps = rowTaxBps(row);
  const ts = rowLaunchTimestamp(row);
  const isV6 = row.curveKind === "v6";
  /**
   * Sanitize here too, not only at the fetch boundary: this component must be safe
   * with whatever metadata object it is handed. A host object rendered as a React
   * child throws "Objects are not valid as a React child", caught by the render
   * check, which is why this exists.
   */
  const meta = useMemo(() => (metadata ? sanitizeMetadata((metadata as { raw?: unknown }).raw ?? metadata) : null), [metadata]);
  return (
    <aside className="detail" ref={asideRef} role="dialog" aria-label={`${row.name} details`}>
      <div className="detail-head">
        <TokenAvatar name={row.name} imageUri={meta?.image} size={44} />
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

      {meta?.description && <p className="detail-desc">{meta.description}</p>}
      {(meta?.twitter || meta?.website || meta?.telegram) && (
        <div className="link-row">
          {meta?.website && (
            <a href={meta.website} target="_blank" rel="noreferrer noopener">
              website
            </a>
          )}
          {meta?.twitter && (
            <a href={socialHref(meta.twitter, "twitter")} target="_blank" rel="noreferrer noopener">
              x
            </a>
          )}
          {meta?.telegram && (
            <a href={socialHref(meta.telegram, "telegram")} target="_blank" rel="noreferrer noopener">
              telegram
            </a>
          )}
        </div>
      )}

      <div className="kv">
        <div>
          <span>Raised on curve</span>
          <b>{fmtEth(raised)} ETH</b>
        </div>
        <div>
          <span>Graduation target</span>
          <b>{target !== null && target > 0n ? `${fmtEth(target)} ETH` : "unverified"}</b>
        </div>
        <div>
          <span>Progress</span>
          <b>{pct(rowProgressBps(row))}</b>
        </div>
        <div>
          <span>{row.priceSource === "quote" ? "Price (from quote)" : "Spot price"}</span>
          <b title={`exact: ${fmtPriceFull(row.spotPriceWad)} ETH`}>{fmtPrice(row.spotPriceWad)} ETH</b>
        </div>
        <div>
          <span>FDV</span>
          <b>{fmtEth(row.fdvWei, 3)} ETH</b>
        </div>
        <div>
          <span>Tokens sold</span>
          <b>{fmtTokens(rowTokensSold(row))}</b>
        </div>
        <div>
          <span>Curve</span>
          <b>{isV6 ? "V6 (renamed surface)" : "classic"}</b>
        </div>
        <div>
          <span>{isV6 ? "Project tax" : "Curve fee"}</span>
          <b>{taxBps !== null ? `${Number(taxBps) / 100}%` : "-"}</b>
        </div>
        <div>
          <span>Creator opening buy</span>
          <b>{isV6 ? "not published by V6 event" : `${fmtEth(row.initialBuy)} ETH`}</b>
        </div>
        <div>
          <span>Status</span>
          <b>{row.graduated ? "graduated / complete" : "on curve"}</b>
        </div>
        <div>
          <span>Launched</span>
          <b>{ts ? `${agoFromUnix(ts)} ago` : "-"}</b>
        </div>
        <div>
          <span>Generation</span>
          <b>{row.factoryLabel}</b>
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
          {!isV6 && (
            <button className="ghost small" onClick={runCheck} disabled={checking}>
              {checking ? "checking…" : "run check"}
            </button>
          )}
        </div>
        {isV6 ? (
          <p className="muted small">
            Not applicable on a <b>V6 curve</b>: it exposes no reserve or price getters (they revert), so this app does not
            model its pricing. The price above is derived from the contract's own <code>quoteBuyExactIn()</code>, the
            marginal price of the next 0.001 ETH, not from a formula. Raised, target, tax and sold counts are read directly
            from the curve.
          </p>
        ) : (
          <>
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
                  <b>
                    {check.curveExhausted
                      ? "curve exhausted: 0 tokens left to sell"
                      : `${check.tokenDelta.toString()} wei (${fmtTokens(check.chainTokens, 1)} from chain${
                          check.cappedByRemaining ? ", capped at the curve's remaining allocation" : ""
                        })`}
                  </b>
                </div>
                <div className={`row verdict ${check.ok ? "ok" : "bad"}`}>
                  <span>verdict</span>
                  <b>{check.ok ? "model reproduces the contract" : "MISMATCH: do not trust simulator"}</b>
                </div>
              </div>
            )}
            {check && (
              <p className={`small ${check.ok ? "muted" : "error"}`}>
                {check.ok
                  ? "In plain words: the tool's curve math matches what this contract does right now, so the simulator's numbers for this launch can be trusted."
                  : "In plain words: the tool and the contract disagree here, so treat this launch's simulated numbers as wrong until that disagreement is understood."}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
