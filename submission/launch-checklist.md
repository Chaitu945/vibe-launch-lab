# Launch walkthrough: from zero to a shipped product and live token

Testnet only. Nothing here costs real money. Test ETH and testnet tokens have no value.

## 0. Prerequisites

- Browser wallet extension: **Rabby** or **MetaMask** (both are supported by the vibe/vibe app).
- A **fresh wallet** is fine and recommended. No mainnet assets should ever touch this network.

## 1. Add the network and get test ETH

| Setting | Value |
|---|---|
| Network | Robinhood Chain Testnet |
| Chain ID | `46630` |
| Currency | ETH |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Faucet | `https://faucet.testnet.chain.robinhood.com/` |

Claim test ETH from the faucet (one claim per 24h). Add the network in your wallet, switch to it, then
open `https://testnet.vibevibe.fun`.

## 2. Publish the product (this is the part the reward track actually grades)

The product-builders track asks for *"a working demo or MVP with evidence that it belongs to the
submitting creator"*. So, in this order:

1. **Create the GitHub repo** under your own account (`Chaitu945/...`) and push this project.
   The repo proves authorship; make it public.
2. **Deploy it** so the demo URL is live (Vercel: import the repo, framework preset Vite, no env vars).
3. **Confirm the deployed URL works** in a fresh private window: scan launches, open a row, run the
   model check, open the simulator. A broken demo URL is worse than no demo URL.
4. Note both links, since you will paste them into the token's project page.

## 3. Create the token

On `testnet.vibevibe.fun`, open **Create** and connect the wallet.

- Name / ticker: `Launch Lab` / `VLAB` (see `token-details.md`).
- Image: upload `submission/logo-512.png`.
- Category: **Product & Utility**.
- Description: paste the block from `token-details.md`.
- Links: the repo URL and the live demo URL.
- Pair: **ETH**. Tax: **1%**. Opening buy: **~0.05 ETH**.
- Graduation airdrop: leave **off** (or ≤2% if you want to test the mechanism).
- Read the review screen: pair, tax, allocation weights, target and holder books are **fixed at
  creation**: nothing here can be changed afterwards. Check the quoted fee and gas before approving.

After the transaction confirms, open the token page and verify it renders with your links.

## 4. Show it to the people who grade it

- Discord: `discord.gg/vibevibebuilders` → project showcase channel. Post the token link, the live
  demo link and one line on what it does. Include the screenshot of a passing **model vs contract**
  check, and that check is what makes this tool look like engineering rather than a wrapper.
- Telegram: `t.me/vibevibefun`, where the community hangs out; the same post works.
- X: draft in `x-post.md`. Tag `@vibevibefun`.

## 5. Keep the evidence current

- The launch must be on the **builder leaderboard** with the product attached, so the project page
  should never point at a dead URL. If you redeploy, update the link on the token page.
- Testnet activity is judged per track: this launch is a **vibecoded/product** submission (1.50%
  combined pool with RWA), not a trader submission. Trading on the launchpad is a *separate* track
  (1.75% user pool). If you want a piece of that too, it wants genuine PnL, not wash volume between
  your own wallets, which is explicitly excluded.
- Copy of the rules, in the team's own words: `testnet.vibevibe.fun/docs` → *Rewards and allocations*.
  The allocation is discretionary; a good launch does not guarantee anything.
