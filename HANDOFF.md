# Handoff — getting Launch Lab live in ~5 minutes

You have the source tree. `node_modules` is deliberately not included.

## 1. Install and run locally

```bash
npm install
npm run dev            # http://localhost:5173
```

Sanity check before you publish anything (all four scripts should print ALL ... PASSED):

```bash
npm run verify         # typecheck + model-vs-contract + live scan + render
npm run check:ui       # mounts the app in a DOM, clicks scan, runs a live verification
```

## 2. Push to GitHub

```bash
git init -b main        # skip if you are using the included .git (see note below)
git add -A
git commit -m "Launch Lab: vibe/vibe testnet launch feed + verified bonding-curve simulator"
gh repo create vibe-launch-lab --public --source=. --push
```

Without the `gh` CLI: create the repo in the GitHub UI, then

```bash
git remote add origin https://github.com/<you>/vibe-launch-lab.git
git push -u origin main
```

> **Don't have git history already?** If you unzipped a tree without `.git`, the `git init` path above
> works as-is. If `.git` came along, `git remote add` + `git push` is all you need — the commit is already made.

## 3. Deploy (pick one)

**Vercel (recommended, matches your portfolio setup)**
- Import the repo at vercel.com → framework preset **Vite** → build `npm run build` → output `dist` → no
  environment variables. `vercel.json` is already included.
- You get `<project>.vercel.app` in ~30 seconds.

**GitHub Pages (no extra account)**
- `.github/workflows/deploy-pages.yml` is already included.
- Repo → Settings → Pages → Source = **GitHub Actions**, then push to `main`. The URL is
  `https://<you>.github.io/vibe-launch-lab/` — `vite.config.ts` already sets `base: "./"`, so it works
  from a subpath with no changes.

**Check the live URL in a private window** before you paste it anywhere: scan launches, open a row, hit
**run check** (it should say "model reproduces the contract"), open the simulator. A dead demo URL is
worse than no demo URL for the reward track.

## 4. Then the token

Follow `submission/launch-checklist.md`: add chain 46630 to your wallet, claim test ETH from the
faucet, create the token on `testnet.vibevibe.fun/create` with the settings in
`submission/token-details.md`, and paste **the repo URL + the live demo URL** into the project's links —
that pairing is what "evidence that it belongs to the submitting creator" means.

Token image: `submission/logo-512.png` (previews at 64/32px included).

## Notes if you change things

- `src/lib/chain.ts` — factory address book, verified constants, ABIs. If a new factory generation ships,
  it goes here or the feed silently misses it (the UI states this limitation).
- `src/lib/curve.ts` — the curve math. `scripts/modelcheck.mjs` will tell you if you break it.
- Never remove the decode-failure counter in `src/lib/scan.ts`: conflating a decode bug with an RPC limit
  is how this app once returned zero launches with no error.
