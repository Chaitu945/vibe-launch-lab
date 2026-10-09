# Drafts for posting

## X / Twitter

> spent the weekend building on top of vibe/vibe instead of complaining about liquidity
>
> Launch Lab: reads every launch off Robinhood Chain Testnet — all three factory generations, not just
> the newest one — and simulates a launch config before you commit it
>
> the part i care about: it calls each curve's own quoteBuy() and spotPriceWad() and checks its math
> against the contract. spot price matches exactly, token output to 1 wei. if it ever disagreed with
> the chain the app would say so instead of showing a confident wrong number
>
> live: <demo url>
> code: <repo url>
> testnet only, nothing here is financial advice
>
> @vibevibefun

Alt hook (shorter, less technical):

> vibe/vibe testnet has ~793.1M of the 800M curve sold by the time a launch graduates, and the price
> runs 14.7x on the way there. built a tool that shows you that before you launch instead of after:
> <demo url>

## Discord / Telegram (project showcase)

> **Launch Lab** — unofficial analytics + curve simulator for the vibe/vibe testnet
>
> What it does:
> • scans TokenLaunched logs across **all three factory generations** (the retired one still produces
> launches — indexing only the newest one misses most of them)
> • shows live raised/progress/price/FDV for anything on a curve, with an hourly activity strip so you
> can see the launch waves
> • simulates a config before you commit: opening buy, price ladder, creator fee at graduation,
> Monte Carlo on "will this even graduate"
> • every token row has a **model vs contract** check — it calls the curve's own quoteBuy/spotPriceWad
> and compares. spot exact, tokens to 1 wei
>
> Token: <token link> · Demo: <demo url> · Code: <repo url>
> Testnet only, not affiliated with vibe/vibe or Seedify, nothing here is financial advice.

## One-liner for the project page links

> Free analytics and launch simulator for vibe/vibe testnet. Reads chain logs directly, verifies its own
> curve math against the deployed contracts, and shows you what a launch config does before you commit
> it. Code and live demo linked.
