# Launch Lab — vibe/vibe testnet analytics

An unofficial analytics and **bonding-curve simulator** for [vibe/vibe](https://testnet.vibevibe.fun) on **Robinhood Chain Testnet** (chain 46630).

It is a client-side app: no backend, no API key, no indexer of its own. It reads launch logs straight off the public testnet RPC and renders them, and it lets a creator model a launch configuration — including what the curve does to their own opening buy — before committing it.

> Not affiliated with, endorsed by, or built by vibe/vibe or Seedify. Testnet only. Testnet tokens have no monetary value.

## What it does

**Live launches**
- Scans `TokenLaunched` and `TokenLaunchedQuoted` logs across **all three known factory generations** (retired / legacy / current), so tokens from older generations still show up.
- Window selector from ~1 hour to ~3 days, with adaptive chunking: the public RPC enforces an undocumented 10,000-log cap and a query time limit, so the scanner halves its window on any RPC error and reports how often it had to.
- Enriches each row with on-chain identity (`name()`, `symbol()`) and curve state (raised, target, progress, spot price, FDV, completion) through Multicall3.
- Honest failure modes: a log that fails to *decode* is reported as a decode failure, never silently swallowed as an RPC limit.

**Launch simulator**
- Presets built from constants read off deployed curves (gen3 ETH pair, gen1, and the SPCX stock pair).
- Projection: launch price, graduation price, buyer multiple, tokens sold at graduation, the creator's own opening buy, fee split.
- Buy ladder: the same buy size pushed through the curve, with per-step price impact and progress.
- Monte Carlo: "will it even graduate?" under a buy distribution you choose (log-normal, configurable farming noise). A model, labelled as one.
- Config score: a stated 4-line rubric (reachability, creator conviction, buyer upside, off-curve supply).

**Model vs contract**
- Every row has a check that calls that curve's own `spotPriceWad()` and `quoteBuy(0.01 ETH)` and compares them with this app's arithmetic. On every curve tested the spot price matched exactly and token output matched to 1 wei.

## The curve, as implemented

Constant product over virtual reserves, fee taken before the reserves move:

```
k              = virtualEth * virtualToken          (constant)
virtualEth     = E0 + realEth
price (quote)  = virtualEth / virtualToken
tokens out     = X0 - k / (E0 + realEth + net)
net            = gross - gross * feeBps / 10000
```

Verified testnet constants (read on-chain, 2026-10-09, head ~131.7M):

| | gen3 (current) | gen1 (retired) |
|---|---|---|
| total fee | 125 bps | 100 bps |
| creator share of fee | 75% | 50% |
| net graduation target | 5 ETH | 0.005 ETH |
| E₀ (initial virtual ETH) | 1.764594628672298575 | 0.001764594628672298 |
| X₀ (initial virtual tokens) | 1,073,000,000 | 1,073,000,000 |

Consequences of those numbers: ~793.1M of the 800M curve allocation is sold by graduation (99.1%), and the price runs ~14.7× from launch to graduation.

## Run it

```bash
npm install
npm run dev          # dev server
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build
```

## Verify it

Every claim above is checked by a script that runs the app's own modules against the live chain:

```bash
npm run model:check        # curve model vs deployed contracts (quoteBuy / spotPriceWad)
npx tsx scripts/harness.ts # scan + enrichment + the model check, against Robinhood Chain Testnet
npx tsx scripts/ssr-check.tsx   # renders every tab; asserts the simulator's headline numbers
npx tsx scripts/ui-check.tsx    # mounts the app in a DOM, clicks scan, opens a drawer, runs a live verification
```

The model check is the important one: if `quoteBuy` ever disagrees with this app's arithmetic, the simulator is wrong and the scripts fail.

## Limitations (read these)

- **Unknown factory generations.** The RPC refuses address-less log queries, so factories must be named explicitly. A generation deployed after this build is invisible until added to `src/lib/chain.ts`. A feed that looks complete can still be incomplete.
- **No holder counts or per-token trade history.** `Transfer`/`Bought`/`Sold` logs are orders of magnitude denser than launches; a rate-limited public RPC cannot scan them per token.
- **Not an archive node.** The public endpoint rejects state reads more than ~4,096 blocks back, so all reads are head-only. Curve state is "as of now", not "as of launch".
- **IPFS metadata is best-effort.** Public gateways rate-limit aggressively (429s are routine), so images may fail to load. Names and symbols always come from the token contract and are unaffected.
- **The Monte Carlo is a model, not a forecast.** It answers "given this buy distribution, how often does the curve fill?" — nothing about who actually shows up.

## Layout

```
src/lib/chain.ts   constants, factory address book, ABIs (all provenance commented)
src/lib/curve.ts   the bonding-curve math, projections, Monte Carlo, scoring rubric
src/lib/scan.ts    log scanning with adaptive chunking, enrichment, live verification
src/lib/metadata.ts IPFS gateway resolution with caching and a monogram fallback
src/components/    feed, simulator, detail drawer, charts, about
scripts/           the verification scripts listed above
submission/        the vibe/vibe launch pack (token details, checklist, drafts)
```
