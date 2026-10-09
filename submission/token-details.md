# Token details for the vibe/vibe launch

Fill these into `testnet.vibevibe.fun/create`. Launch settings (pair, tax, allocation, target, holder
books) are **immutable once created** — review the review screen twice.

## Identity

| Field | Value |
|---|---|
| Name | `Launch Lab` |
| Ticker | `VLAB` (alternates: `LABL`, `CURVE`) |
| Category | **Product & Utility** (it is a tool, not a meme) |
| Image | `submission/logo-512.png` (upload; 1:1, dark background, >512px) |
| Links | GitHub repo + live demo URL (both go on the project page — this is what "evidence it belongs to the submitting creator" means) |

## Description (paste, trim if the field is short)

> Launch Lab is a free analytics and simulation tool for vibe/vibe on Robinhood Chain Testnet.
>
> It scans the launchpad's own `TokenLaunched` logs across every factory generation and shows what is actually live right now — raised, progress to graduation, price, FDV and whether the curve has completed — without an indexer or an API key. Alongside that it simulates a launch configuration before you commit one: what your opening buy costs you, what the price does on the way to the target, what the creator fee split is worth at graduation, and how often the curve would fill under a buy distribution you choose.
>
> Every number is checked against the deployed contracts: the app calls each curve's `spotPriceWad()` and `quoteBuy()` and compares them with its own math. If they disagree, the app says so instead of showing a confident wrong number.
>
> Testnet only. No real funds, nothing here is financial advice, and this tool is not affiliated with vibe/vibe or Seedify.

## Launch settings to use

| Setting | Recommendation | Why |
|---|---|---|
| Pair | ETH | The verified constants (5 ETH target, 1.25% fee) are for the ETH pair; stock pairs use different reserves. |
| Tax | 1% (lowest available) | The curve already takes 1.25% per trade; stacking a 3% project tax on top of a curve that traders are testing is what kills testnet volume. |
| Opening buy | ~0.05 ETH of test ETH | This is the range real creators use (observed 0.051 ETH in the current generation). It signals conviction without eating your curve. |
| Graduation airdrop | Off, or ≤2% | The airdrop allocation plus opening buy cannot exceed half the supply, and off-curve supply is the first thing traders read as exit liquidity. |
| Reflection/burn options | Off | Keep the config legible. Every knob you turn is one more thing to explain on the project page. |

## What the judges are told to look for

Straight from the vibe/vibe docs (Rewards and allocations):

- Vibecoded/product creators: *"a working demo or MVP with evidence that it belongs to the submitting creator."*

That means the repo and the deployed demo, both under your account, linked from the project page — not a
screenshot and not a description of a plan. Keep the repo public, keep the demo URL live, and put both in
the project's links.
