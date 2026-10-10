/**
 * Bonding-curve math: the protocol's own arithmetic, in pure bigint.
 *
 * MODEL (established from chain state, then checked against the contracts)
 * ----------------------------------------------------------------------
 * Each launch gets its own curve contract. It is a constant-product curve over
 * VIRTUAL reserves:
 *
 *     k = virtualEth * virtualToken          (constant, per curve)
 *     virtualEth   = E0 + realEth            (E0 = INITIAL_VIRTUAL_ETH_RESERVE)
 *     price (quote per token) = virtualEth / virtualToken
 *
 * Buys take a fee first (TOTAL_FEE_BPS of the gross, split creator/protocol) and
 * the net quote moves the reserves; tokens out are `X0 - k / (E0 + realEth + net)`.
 * Sells are the mirror image onto the reserve held by the curve.
 *
 * VALIDATION: `scripts/modelcheck.mjs` compares this model against each live
 * curve's own `quoteBuy()` and `spotPriceWad()`. On three live curves the token
 * output matched to 1 wei and the spot price matched exactly. Anything that
 * disagrees with the chain is a bug in here, not in the curve.
 *
 * ETH is denominated in wei (bigint). Token amounts are 18-decimal bigints.
 */

export const WAD = 10n ** 18n;
export const BPS = 10_000n;

export interface CurveState {
  /** Virtual quote reserve (wei). */
  virtualEth: bigint;
  /** Virtual token reserve (18dp). */
  virtualToken: bigint;
  /** Real quote raised on the curve (wei). This is what counts toward graduation. */
  realEth: bigint;
  /** Total fee in bps. */
  feeBps: bigint;
  /** Creator's share of the fee, in bps of the fee. */
  creatorShareBps: bigint;
  /** Net graduation target (wei), i.e. realEth needed. 0n = unknown. */
  target: bigint;
  complete: boolean;
}

export interface LaunchConfig {
  /** Initial virtual quote reserve (wei). */
  e0: bigint;
  /** Initial virtual token reserve (18dp). */
  x0: bigint;
  /** Net graduation target (wei). */
  target: bigint;
  feeBps: bigint;
  creatorShareBps: bigint;
  /** Creator's atomic buy at launch, gross wei. 0n for none. */
  initialBuy: bigint;
}

export function freshState(cfg: LaunchConfig): CurveState {
  const state: CurveState = {
    virtualEth: cfg.e0,
    virtualToken: cfg.x0,
    realEth: 0n,
    feeBps: cfg.feeBps,
    creatorShareBps: cfg.creatorShareBps,
    target: cfg.target,
    complete: false,
  };
  if (cfg.initialBuy > 0n) {
    const after = buy(state, cfg.initialBuy);
    return after.next;
  }
  return state;
}

/** Constant product of the curve, from its current reserves. */
export function kOf(s: CurveState): bigint {
  return s.virtualEth * s.virtualToken;
}

/** The curve's initial virtual quote reserve, recovered from state (E0 = virtualEth - realEth). */
export function e0Of(s: CurveState): bigint {
  const e0 = s.virtualEth - s.realEth;
  return e0 > 0n ? e0 : 1n;
}

/** The curve's initial virtual token reserve: X0 = k / E0. */
export function x0Of(s: CurveState): bigint {
  return kOf(s) / e0Of(s);
}

/** Quote price per token, in wei (18dp). */
export function priceWad(s: CurveState): bigint {
  if (s.virtualToken === 0n) return 0n;
  return (s.virtualEth * WAD) / s.virtualToken;
}

/** Fully-diluted valuation in wei for a given total supply. */
export function fdvWei(s: CurveState, totalSupply: bigint): bigint {
  return (priceWad(s) * totalSupply) / WAD;
}

/** Tokens sold by the curve so far (X0 - virtualToken). */
export function tokensSold(s: CurveState): bigint {
  const x0 = x0Of(s);
  return x0 > s.virtualToken ? x0 - s.virtualToken : 0n;
}

/** Real quote raised so far, in wei. */
export function raised(s: CurveState): bigint {
  return s.realEth;
}

export interface TradeResult {
  next: CurveState;
  tokens: bigint;
  /** Gross quote moved out of the buyer's wallet (after refund logic). */
  gross: bigint;
  /** Net quote that actually moved the reserves. */
  net: bigint;
  fee: bigint;
  creatorFee: bigint;
  protocolFee: bigint;
  priceBefore: bigint;
  priceAfter: bigint;
  /** Price impact in bps of the pre-trade price. */
  impactBps: number;
  /** True when the buy would push the curve past its graduation target. */
  completesGraduation: boolean;
}

/** Buy with a gross quote amount (the fee is taken out of it first). */
export function buy(s: CurveState, gross: bigint): TradeResult {
  const priceBefore = priceWad(s);
  const fee = (gross * s.feeBps) / BPS;
  const net = gross - fee;
  const k = kOf(s);
  const virtualEthAfter = s.virtualEth + net;
  const virtualTokenAfter = k / virtualEthAfter;
  const tokens = s.virtualToken - virtualTokenAfter;
  const realAfter = s.realEth + net;
  const completes = s.target > 0n && realAfter >= s.target;
  const next: CurveState = {
    ...s,
    virtualEth: virtualEthAfter,
    virtualToken: virtualTokenAfter,
    realEth: realAfter,
    complete: completes || s.complete,
  };
  const priceAfter = priceWad(next);
  const impactBps = priceBefore > 0n ? Number(((priceAfter - priceBefore) * BPS) / priceBefore) : 0;
  const creatorFee = (fee * s.creatorShareBps) / BPS;
  return {
    next,
    tokens,
    gross,
    net,
    fee,
    creatorFee,
    protocolFee: fee - creatorFee,
    priceBefore,
    priceAfter,
    impactBps,
    completesGraduation: completes,
  };
}

export interface SellResult {
  next: CurveState;
  quoteOut: bigint;
  grossQuote: bigint;
  fee: bigint;
  priceBefore: bigint;
  priceAfter: bigint;
  impactBps: number;
}

/** Sell an exact token amount back into the curve. */
export function sell(s: CurveState, tokenAmount: bigint): SellResult {
  const priceBefore = priceWad(s);
  const k = kOf(s);
  const virtualTokenAfter = s.virtualToken + tokenAmount;
  const virtualEthAfter = k / virtualTokenAfter;
  const netQuote = s.virtualEth - virtualEthAfter;
  const fee = (netQuote * s.feeBps) / (BPS - s.feeBps);
  const grossQuote = netQuote; // quote removed from the curve's virtual reserve
  const quoteOut = netQuote - fee;
  const realAfter = s.realEth > netQuote ? s.realEth - netQuote : 0n;
  const next: CurveState = {
    ...s,
    virtualEth: virtualEthAfter,
    virtualToken: virtualTokenAfter,
    realEth: realAfter,
  };
  const priceAfter = priceWad(next);
  const impactBps = priceBefore > 0n ? Number(((priceBefore - priceAfter) * BPS) / priceBefore) : 0;
  return { next, quoteOut, grossQuote, fee, priceBefore, priceAfter, impactBps };
}

/** Quote needed (net and gross) to reach the graduation target from here. */
export function toGraduate(s: CurveState): { netNeeded: bigint; grossNeeded: bigint; alreadyComplete: boolean } {
  if (s.target === 0n) return { netNeeded: 0n, grossNeeded: 0n, alreadyComplete: false };
  if (s.realEth >= s.target) return { netNeeded: 0n, grossNeeded: 0n, alreadyComplete: true };
  const netNeeded = s.target - s.realEth;
  const grossNeeded = (netNeeded * BPS) / (BPS - s.feeBps) + 1n;
  return { netNeeded, grossNeeded, alreadyComplete: false };
}

export function progressBps(s: CurveState): number | null {
  if (s.target === 0n) return null;
  return Number((s.realEth * BPS) / s.target);
}

/** Tokens the curve sells on the way to graduation, the "% of curve sold" denominator. */
export function soldAtGraduation(cfg: LaunchConfig): bigint {
  const k = cfg.e0 * cfg.x0;
  return cfg.x0 - k / (cfg.e0 + cfg.target);
}

export interface BuyStep {
  index: number;
  gross: bigint;
  tokens: bigint;
  priceBefore: bigint;
  priceAfter: bigint;
  impactBps: number;
  raisedAfter: bigint;
  progressAfterBps: number | null;
  fee: bigint;
}

/** Walk a sequence of buys through the curve. */
export function ladder(state: CurveState, gross: bigint, count: number): { steps: BuyStep[]; final: CurveState; graduatedAt: number | null } {
  const steps: BuyStep[] = [];
  let cur = state;
  let graduatedAt: number | null = cur.complete ? 0 : null;
  for (let i = 1; i <= count; i++) {
    const r = buy(cur, gross);
    steps.push({
      index: i,
      gross,
      tokens: r.tokens,
      priceBefore: r.priceBefore,
      priceAfter: r.priceAfter,
      impactBps: r.impactBps,
      raisedAfter: r.next.realEth,
      progressAfterBps: progressBps(r.next),
      fee: r.fee,
    });
    cur = r.next;
    if (graduatedAt === null && r.completesGraduation) graduatedAt = i;
  }
  return { steps, final: cur, graduatedAt };
}

/** Price ladder across the curve: what the price is at each level of quote raised. */
export function priceCurve(cfg: LaunchConfig, points = 120): { raised: number; price: number }[] {
  const k = cfg.e0 * cfg.x0;
  const out: { raised: number; price: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const realEth = (cfg.target * BigInt(i)) / BigInt(points);
    const virtualEth = cfg.e0 + realEth;
    const virtualToken = k / virtualEth;
    out.push({
      raised: Number(realEth) / 1e18,
      price: Number((virtualEth * WAD) / virtualToken) / 1e18,
    });
  }
  return out;
}

export interface LaunchProjection {
  priceAtLaunch: bigint;
  priceAtGraduation: bigint;
  multiple: number;
  tokensSoldAtGraduation: bigint;
  pctOfCurveSold: number;
  tokensAtLaunchBuy: bigint;
  quoteRaisedAtGraduation: bigint;
  fdvAtGraduation: bigint;
  feeAtGraduation: bigint;
  creatorFeeAtGraduation: bigint;
  protocolFeeAtGraduation: bigint;
  initialBuyPctOfTarget: number;
  initialBuyPctOfTokensAtGrad: number;
}

/** Everything a creator wants to know before they commit a launch config. */
export function projectLaunch(cfg: LaunchConfig, totalSupply: bigint): LaunchProjection {
  const start: CurveState = {
    virtualEth: cfg.e0,
    virtualToken: cfg.x0,
    realEth: 0n,
    feeBps: cfg.feeBps,
    creatorShareBps: cfg.creatorShareBps,
    target: cfg.target,
    complete: false,
  };
  const priceAtLaunch = priceWad(start);
  const initialBuyResult = cfg.initialBuy > 0n ? buy(start, cfg.initialBuy) : null;
  const stateAfterBuy = initialBuyResult ? initialBuyResult.next : start;
  const grad = toGraduate(stateAfterBuy);
  const gradBuy = buy(stateAfterBuy, grad.grossNeeded);
  const sold = tokensSold(gradBuy.next);
  const totalFee = (gradBuy.next.realEth * cfg.feeBps) / (BPS - cfg.feeBps) + (stateAfterBuy.realEth * cfg.feeBps) / (BPS - cfg.feeBps);
  const creatorFee = (totalFee * cfg.creatorShareBps) / BPS;
  const soldAtGrad = soldAtGraduation(cfg);
  return {
    priceAtLaunch,
    priceAtGraduation: priceWad(gradBuy.next),
    multiple: Number(priceWad(gradBuy.next)) / Number(priceAtLaunch || 1n),
    tokensSoldAtGraduation: sold,
    pctOfCurveSold: soldAtGrad > 0n ? Number((sold * 10_000n) / soldAtGrad) / 100 : 0,
    tokensAtLaunchBuy: initialBuyResult ? initialBuyResult.tokens : 0n,
    quoteRaisedAtGraduation: gradBuy.next.realEth,
    fdvAtGraduation: fdvWei(gradBuy.next, totalSupply),
    feeAtGraduation: totalFee,
    creatorFeeAtGraduation: creatorFee,
    protocolFeeAtGraduation: totalFee - creatorFee,
    initialBuyPctOfTarget: cfg.target > 0n ? Number((cfg.initialBuy * 10_000n) / cfg.target) / 100 : 0,
    initialBuyPctOfTokensAtGrad: soldAtGrad > 0n && initialBuyResult ? Number((initialBuyResult.tokens * 10_000n) / soldAtGrad) / 100 : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Monte Carlo: "will this even graduate?"
 * This is a MODEL of buyer behaviour, not a prediction. It takes a
 * distribution of buy sizes (which you choose) and asks how often the
 * curve crosses its target within a fixed number of buys.
 * ------------------------------------------------------------------ */

export interface MonteCarloInputs {
  buyers: number;
  /** Mean buy size in ETH. */
  meanBuyEth: number;
  /** Log-normal shape parameter (>0). 0 = identical buys. */
  sigma: number;
  trials: number;
  seed?: number;
  /** Fraction of buyers that sell immediately instead of buying (farming noise). */
  washFraction: number;
}

export interface MonteCarloResult {
  graduationRate: number;
  medianRaisedEth: number;
  p10RaisedEth: number;
  p90RaisedEth: number;
  medianBuysToGraduate: number | null;
  trials: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lognormal(rand: () => number, mean: number, sigma: number): number {
  if (sigma <= 0) return mean;
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  return Math.exp(mu + sigma * z);
}

export function monteCarlo(state: CurveState, input: MonteCarloInputs): MonteCarloResult {
  const rand = mulberry32(input.seed ?? 42);
  const raised: number[] = [];
  const buysToGrad: number[] = [];
  let graduated = 0;
  for (let t = 0; t < input.trials; t++) {
    let cur = state;
    let buys = 0;
    let done = false;
    for (let b = 0; b < input.buyers; b++) {
      if (rand() < input.washFraction) continue;
      const eth = lognormal(rand, input.meanBuyEth, input.sigma);
      if (eth <= 0) continue;
      const gross = BigInt(Math.max(1, Math.round(eth * 1e18)));
      const r = buy(cur, gross);
      cur = r.next;
      buys++;
      if (r.completesGraduation) {
        done = true;
        break;
      }
    }
    raised.push(Number(cur.realEth) / 1e18);
    if (done) {
      graduated++;
      buysToGrad.push(buys);
    }
  }
  raised.sort((a, b) => a - b);
  buysToGrad.sort((a, b) => a - b);
  const pick = (q: number) => (raised.length ? raised[Math.min(raised.length - 1, Math.floor(q * raised.length))] : 0);
  return {
    graduationRate: graduated / input.trials,
    medianRaisedEth: pick(0.5),
    p10RaisedEth: pick(0.1),
    p90RaisedEth: pick(0.9),
    medianBuysToGraduate: buysToGrad.length ? buysToGrad[Math.floor(buysToGrad.length / 2)] : null,
    trials: input.trials,
  };
}

/* ------------------------------------------------------------------ *
 * Config scoring: a stated rubric, not a black box.
 * ------------------------------------------------------------------ */

export interface ScoreInputs {
  projection: LaunchProjection;
  monteCarlo: MonteCarloResult;
  /** How many tokens the creator + airdrop hold at graduation, as % of supply. */
  creatorSupplyPct: number;
}

export interface ScoreLine {
  label: string;
  points: number;
  max: number;
  verdict: string;
}

export interface ScoreResult {
  total: number;
  max: number;
  grade: string;
  lines: ScoreLine[];
}

export function scoreConfig(input: ScoreInputs): ScoreResult {
  const { projection, monteCarlo, creatorSupplyPct } = input;
  const lines: ScoreLine[] = [];

  // 1. Reachability: does the curve graduate under a plausible buy distribution?
  const reach = Math.min(30, Math.round(monteCarlo.graduationRate * 30));
  lines.push({
    label: "Graduation reachability",
    points: reach,
    max: 30,
    verdict:
      monteCarlo.graduationRate > 0.7
        ? "Target is comfortably reachable under your buy assumptions."
        : monteCarlo.graduationRate > 0.3
          ? "Target is reachable but needs a real audience, not a handful of buys."
          : "Target looks unreachable at this buy distribution, so lower it or bring volume.",
  });

  // 2. Creator skin in the game (initial buy relative to target).
  const skin = Math.min(25, Math.round((projection.initialBuyPctOfTarget / 5) * 25));
  lines.push({
    label: "Creator conviction (opening buy vs target)",
    points: skin,
    max: 25,
    verdict:
      projection.initialBuyPctOfTarget > 3
        ? "Strong opening buy: you are signalling before anyone else commits."
        : projection.initialBuyPctOfTarget > 0.5
          ? "Modest opening buy."
          : "No meaningful opening buy; expect to rely entirely on outside buyers.",
  });

  // 3. Buyers' upside (price multiple launch -> graduation).
  const upside = projection.multiple;
  const upsidePoints = upside >= 10 ? 25 : upside >= 5 ? 18 : upside >= 3 ? 12 : 6;
  lines.push({
    label: "Buyer upside (launch → graduation price)",
    points: upsidePoints,
    max: 25,
    verdict: `${upside.toFixed(1)}x from launch price to graduation price. Below ~3x early buyers rarely chase.`,
  });

  // 4. Creator's own share: too much supply at launch reads as exit liquidity.
  const sharePoints = creatorSupplyPct <= 10 ? 20 : creatorSupplyPct <= 25 ? 12 : 4;
  lines.push({
    label: "Creator/airdrop share of supply",
    points: sharePoints,
    max: 20,
    verdict:
      creatorSupplyPct <= 10
        ? "Healthy: most supply is on the curve."
        : creatorSupplyPct <= 25
          ? "Acceptable, but disclose it clearly on the project page."
          : "Most supply sits off the curve, so expect traders to treat it as exit liquidity.",
  });

  const total = lines.reduce((a, l) => a + l.points, 0);
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";
  return { total, max: 100, grade, lines };
}
