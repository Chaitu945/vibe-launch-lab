import { useMemo, useState } from "react";
import { ETH_PAIR, STOCK_QUOTE } from "../lib/chain";
import {
  buy,
  freshState,
  ladder,
  monteCarlo,
  priceCurve,
  projectLaunch,
  progressBps,
  scoreConfig,
  toGraduate,
  type CurveState,
  type LaunchConfig,
} from "../lib/curve";
import { fmtEth, fmtPrice, fmtTokens, pct } from "../lib/format";
import { PriceCurveChart } from "./PriceCurveChart";

const QUOTE_TOKENS = 10n ** 6n;

/** UI numbers (6dp) → wei. */
function toWei(n: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1e6)) * 10n ** 12n;
}
function toTokens(millions: number): bigint {
  return BigInt(Math.round(millions * 1e6)) * 10n ** 12n;
}

type PresetKey = "gen3" | "gen1" | "stock";

interface PresetValues {
  e0: number;
  x0Millions: number;
  target: number;
  feeBps: number;
  creatorSharePct: number;
  label: string;
  note: string;
}

const PRESETS: Record<PresetKey, PresetValues> = {
  gen3: {
    e0: Number(ETH_PAIR.initialVirtualEthReserve) / 1e18,
    x0Millions: Number(ETH_PAIR.initialVirtualTokenReserve / QUOTE_TOKENS) / 1e6,
    target: Number(ETH_PAIR.netGraduationTarget) / 1e18,
    feeBps: Number(ETH_PAIR.feeBps),
    creatorSharePct: Number(ETH_PAIR.creatorShareBps) / 100,
    label: "gen3 ETH pair (live)",
    note: "Current generation. Every constant below was read from deployed curves.",
  },
  gen1: {
    e0: Number(ETH_PAIR.initialVirtualEthReserveGen1) / 1e18,
    x0Millions: Number(ETH_PAIR.initialVirtualTokenReserve / QUOTE_TOKENS) / 1e6,
    target: Number(ETH_PAIR.netGraduationTargetGen1) / 1e18,
    feeBps: Number(ETH_PAIR.feeBpsGen1),
    creatorSharePct: Number(ETH_PAIR.creatorShareBpsGen1) / 100,
    label: "gen1 (retired)",
    note: "Retired generation: 100 bps fee, 50/50 split, 0.005 ETH graduation target.",
  },
  stock: {
    e0: Number(STOCK_QUOTE.initialVirtualReserve) / 1e18,
    x0Millions: Number(ETH_PAIR.initialVirtualTokenReserve / QUOTE_TOKENS) / 1e6,
    target: Number(STOCK_QUOTE.netGraduationTarget) / 1e18,
    feeBps: Number(ETH_PAIR.feeBps),
    creatorSharePct: Number(ETH_PAIR.creatorShareBps) / 100,
    label: `${STOCK_QUOTE.symbol} stock pair`,
    note: "Stock-paired launches quote in the registered mock stock token (18dp) instead of ETH.",
  },
};

export function Simulator() {
  const [preset, setPreset] = useState<PresetKey>("gen3");
  const [advanced, setAdvanced] = useState(false);
  const [e0, setE0] = useState(PRESETS.gen3.e0);
  const [x0Millions, setX0] = useState(PRESETS.gen3.x0Millions);
  const [target, setTarget] = useState(PRESETS.gen3.target);
  const [feeBps, setFeeBps] = useState(PRESETS.gen3.feeBps);
  const [creatorSharePct, setCreatorSharePct] = useState(PRESETS.gen3.creatorSharePct);
  const [initialBuy, setInitialBuy] = useState(0.05);
  const [creatorSupplyPct, setCreatorSupplyPct] = useState(10);

  const [buySize, setBuySize] = useState(0.1);
  const [buyCount, setBuyCount] = useState(40);
  const [buyers, setBuyers] = useState(60);
  const [meanBuy, setMeanBuy] = useState(0.05);
  const [sigma, setSigma] = useState(0.9);
  const [washFraction, setWash] = useState(0.4);
  const [trials, setTrials] = useState(600);

  const applyPreset = (key: PresetKey) => {
    const p = PRESETS[key];
    setPreset(key);
    setE0(p.e0);
    setX0(p.x0Millions);
    setTarget(p.target);
    setFeeBps(p.feeBps);
    setCreatorSharePct(p.creatorSharePct);
  };

  const cfg: LaunchConfig = useMemo(
    () => ({
      e0: toWei(e0),
      x0: toTokens(x0Millions),
      target: toWei(target),
      feeBps: BigInt(Math.max(0, Math.round(feeBps))),
      creatorShareBps: BigInt(Math.round(Math.min(100, Math.max(0, creatorSharePct)) * 100)),
      initialBuy: toWei(initialBuy),
    }),
    [e0, x0Millions, target, feeBps, creatorSharePct, initialBuy],
  );

  const startState: CurveState = useMemo(() => freshState(cfg), [cfg]);
  const projection = useMemo(() => projectLaunch(cfg, ETH_PAIR.totalSupply), [cfg]);
  const points = useMemo(() => priceCurve(cfg, 100), [cfg]);
  const ladderRun = useMemo(() => ladder(startState, toWei(buySize), Math.min(400, Math.max(1, Math.round(buyCount)))), [startState, buySize, buyCount]);
  const mc = useMemo(
    () => monteCarlo(startState, { buyers, meanBuyEth: meanBuy, sigma, washFraction, trials, seed: 7 }),
    [startState, buyers, meanBuy, sigma, washFraction, trials],
  );
  const score = useMemo(
    () => scoreConfig({ projection, monteCarlo: mc, creatorSupplyPct }),
    [projection, mc, creatorSupplyPct],
  );
  const grad = useMemo(() => toGraduate(startState), [startState]);
  const oneEth = useMemo(() => buy(startState, 10n ** 18n), [startState]);

  return (
    <div className="sim">
      <div className="panel">
        <div className="panel-head">
          <b>Launch configuration</b>
          <span className="muted small">presets come from deployed curves, not docs</span>
        </div>
        <div className="preset-row">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button key={k} className={preset === k ? "chip on" : "chip"} onClick={() => applyPreset(k)}>
              {PRESETS[k].label}
            </button>
          ))}
        </div>
        <p className="muted small">{PRESETS[preset].note}</p>
        <p className="muted small">
          This models the <b>classic generations</b> (gen1-gen3): their curve is constant-product over virtual reserves and the
          math here is verified against their contracts. The newer V6 curves use a different, unrecovered shape, and the feed shows
          their live numbers, but this panel does not simulate them.
        </p>

        <div className="grid-inputs">
          <label>
            opening buy (ETH)
            <input type="number" step="0.01" min="0" value={initialBuy} onChange={(e) => setInitialBuy(Number(e.target.value))} />
          </label>
          <label>
            net graduation target (ETH)
            <input type="number" step="0.1" min="0" value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          </label>
          <label>
            total fee (bps)
            <input type="number" step="5" min="0" value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} />
          </label>
          <label>
            creator share of fee (%)
            <input type="number" step="5" min="0" max="100" value={creatorSharePct} onChange={(e) => setCreatorSharePct(Number(e.target.value))} />
          </label>
          <label>
            your supply off-curve (%)
            <input type="number" step="1" min="0" max="100" value={creatorSupplyPct} onChange={(e) => setCreatorSupplyPct(Number(e.target.value))} />
          </label>
        </div>

        <button className="ghost small" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "hide" : "show"} virtual reserves (advanced)
        </button>
        {advanced && (
          <div className="grid-inputs">
            <label>
              initial virtual ETH reserve (E₀)
              <input type="number" step="0.01" min="0.000001" value={e0} onChange={(e) => setE0(Number(e.target.value))} />
            </label>
            <label>
              initial virtual token reserve (X₀, millions)
              <input type="number" step="1" min="1" value={x0Millions} onChange={(e) => setX0(Number(e.target.value))} />
            </label>
          </div>
        )}
      </div>

      <p className="muted small">
        In plain words: with this config the price starts at <b>{fmtPrice(projection.priceAtLaunch)} ETH</b> per token and ends at{" "}
        <b>{fmtPrice(projection.priceAtGraduation)} ETH</b> once the curve is full, so anyone buying at launch is up{" "}
        <b>{projection.multiple.toFixed(1)}x</b> by then. Filling the curve still takes{" "}
        <b>{fmtEth(grad.grossNeeded, 3)} ETH</b> of buying from other people.
      </p>

      <div className="stats">
        <div className="stat" title="Price per token when your opening buy lands.">
          <span>price at launch</span>
          <b>{fmtPrice(projection.priceAtLaunch)} ETH</b>
        </div>
        <div className="stat" title="Price per token once the curve has sold its 800M allocation.">
          <span>price at graduation</span>
          <b>{fmtPrice(projection.priceAtGraduation)} ETH</b>
        </div>
        <div className="stat" title="Price at graduation divided by price at launch.">
          <span>buyer upside</span>
          <b>{projection.multiple.toFixed(1)}x</b>
        </div>
        <div className="stat" title="Tokens your opening buy gets you, after the buy's own price impact.">
          <span>tokens you get for the opening buy</span>
          <b>{fmtTokens(projection.tokensAtLaunchBuy)}</b>
        </div>
        <div className="stat" title="Your opening buy as a share of the ETH needed to graduate.">
          <span>opening buy vs target</span>
          <b>{projection.initialBuyPctOfTarget.toFixed(2)}%</b>
        </div>
        <div className="stat" title="How much more buying fills the curve.">
          <span>ETH still needed to graduate</span>
          <b>{fmtEth(grad.grossNeeded, 3)}</b>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>Curve shape</b>
          <span className="muted small">
            price vs quote raised · graduation at {target} ETH · {pct(progressBps(startState), 1)} reached by the opening buy
          </span>
        </div>
        <PriceCurveChart points={points} target={target} />
        <p className="muted small">
          At graduation the curve has sold {fmtTokens(projection.tokensSoldAtGraduation)} of its 800M allocation (
          {projection.pctOfCurveSold.toFixed(1)}%), leaving {(100 - projection.pctOfCurveSold).toFixed(1)}% for the locked pool.
          Fees taken across the whole curve at graduation: {fmtEth(projection.feeAtGraduation, 4)} ETH: {fmtEth(projection.creatorFeeAtGraduation, 4)} to the
          creator, {fmtEth(projection.protocolFeeAtGraduation, 4)} to the protocol.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>Buy ladder</b>
          <span className="muted small">every row is the same buy size pushed through the curve</span>
        </div>
        <div className="grid-inputs narrow">
          <label>
            buy size (ETH)
            <input type="number" step="0.01" min="0.0001" value={buySize} onChange={(e) => setBuySize(Number(e.target.value))} />
          </label>
          <label>
            number of buys
            <input type="number" step="1" min="1" max="400" value={buyCount} onChange={(e) => setBuyCount(Number(e.target.value))} />
          </label>
          <div className="inline-note">
            1 ETH now buys {fmtTokens(oneEth.tokens)} tokens · {oneEth.impactBps} bps impact ·{" "}
            {ladderRun.graduatedAt === null ? "does not graduate in this ladder" : `graduates at buy #${ladderRun.graduatedAt}`}
          </div>
        </div>
        <div className="table ladder">
          <div className="tr th">
            <span>#</span>
            <span className="num">buy</span>
            <span className="num">tokens</span>
            <span className="num">price after</span>
            <span className="num">impact</span>
            <span className="num">raised</span>
            <span className="num">progress</span>
          </div>
          {ladderRun.steps.slice(0, 60).map((s) => (
            <div className="tr" key={s.index}>
              <span className="muted small">{s.index}</span>
              <span className="num">{fmtEth(s.gross, 2)}</span>
              <span className="num">{fmtTokens(s.tokens, 0)}</span>
              <span className="num">{fmtPrice(s.priceAfter)}</span>
              <span className="num">{s.impactBps} bps</span>
              <span className="num">{fmtEth(s.raisedAfter, 3)}</span>
              <span className="num">{pct(s.progressAfterBps, 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>Will it graduate? (Monte Carlo)</b>
          <span className="muted small">a model of buyer behaviour you configure, not a prediction</span>
        </div>
        <div className="grid-inputs">
          <label>
            buyers
            <input type="number" step="5" min="1" max="2000" value={buyers} onChange={(e) => setBuyers(Number(e.target.value))} />
          </label>
          <label>
            mean buy (ETH)
            <input type="number" step="0.01" min="0.001" value={meanBuy} onChange={(e) => setMeanBuy(Number(e.target.value))} />
          </label>
          <label>
            spread σ (0 = identical buys)
            <input type="number" step="0.1" min="0" max="2" value={sigma} onChange={(e) => setSigma(Number(e.target.value))} />
          </label>
          <label>
            farming noise (share who never buy)
            <input type="number" step="0.05" min="0" max="0.95" value={washFraction} onChange={(e) => setWash(Number(e.target.value))} />
          </label>
          <label>
            trials
            <input type="number" step="100" min="50" max="5000" value={trials} onChange={(e) => setTrials(Number(e.target.value))} />
          </label>
        </div>
        <div className="stats">
          <div className="stat">
            <span>graduation rate</span>
            <b>{(mc.graduationRate * 100).toFixed(1)}%</b>
          </div>
          <div className="stat">
            <span>median raised</span>
            <b>{mc.medianRaisedEth.toFixed(3)} ETH</b>
          </div>
          <div className="stat">
            <span>10th-90th pct</span>
            <b>
              {mc.p10RaisedEth.toFixed(3)}-{mc.p90RaisedEth.toFixed(3)}
            </b>
          </div>
          <div className="stat">
            <span>median buys to graduate</span>
            <b>{mc.medianBuysToGraduate ?? "-"}</b>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>Config score</b>
          <span className="muted small">stated rubric, not a black box</span>
          <span className={`grade ${score.grade}`}>{score.grade}</span>
        </div>
        <div className="score-lines">
          {score.lines.map((l) => (
            <div className="score-line" key={l.label}>
              <div className="score-top">
                <b>{l.label}</b>
                <span className="muted small">
                  {l.points}/{l.max}
                </span>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${(l.points / l.max) * 100}%` }} />
              </div>
              <p className="muted small">{l.verdict}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
