/**
 * Render + math acceptance checks (no browser needed).
 *
 *   1. Renders every tab to static markup with react-dom/server: a component
 *      that throws on render fails here.
 *   2. Checks the simulator's headline numbers against values derived
 *      independently from chain state (see the comment on each expectation).
 *
 *   npx tsx scripts/ssr-check.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import App from "../src/App";
import { Simulator } from "../src/components/Simulator";
import { About } from "../src/components/About";
import { TokenDetail } from "../src/components/TokenDetail";
import { TokenAvatar } from "../src/components/TokenAvatar";
import { sanitizeMetadata, type ProjectMetadata } from "../src/lib/metadata";
import { ETH_PAIR, blocksForHours, EARLIEST_DEPLOYMENT_BLOCK } from "../src/lib/chain";
import { fmtEth, fmtPrice } from "../src/lib/format";
import { buy, freshState, projectLaunch, soldAtGraduation, type LaunchConfig } from "../src/lib/curve";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

// ---------- 1. rendering ----------
const appHtml = renderToStaticMarkup(createElement(App));
check("App renders", appHtml.length > 500, `${appHtml.length} chars`);
check("masthead present", appHtml.includes("Launch Lab"));
check("all three tabs render", ["Live launches", "Launch simulator", "How it works"].every((t) => appHtml.includes(t)));
check("disclaimer rendered", appHtml.includes("Not affiliated with vibe/vibe"));

const simHtml = renderToStaticMarkup(createElement(Simulator));
check("Simulator renders", simHtml.includes("Launch configuration") && simHtml.includes("Monte Carlo"));
check("simulator shows a graduation multiple", /\d+\.\dx/.test(simHtml), simHtml.match(/\d+\.\dx/)?.[0] ?? "none");

const aboutHtml = renderToStaticMarkup(createElement(About));
check("About renders with limitations", aboutHtml.includes("What this tool cannot see") && aboutHtml.includes("Unknown factory generations"));

// TokenDetail needs a row; build a minimal one from live-shaped values.
const cfg: LaunchConfig = {
  e0: ETH_PAIR.initialVirtualEthReserve,
  x0: ETH_PAIR.initialVirtualTokenReserve,
  target: ETH_PAIR.netGraduationTarget,
  feeBps: ETH_PAIR.feeBps,
  creatorShareBps: ETH_PAIR.creatorShareBps,
  initialBuy: 51_397_000_000_000_000n,
};
const state = freshState(cfg);
const detailRow = {
  generation: "current" as const,
  factoryLabel: "gen3",
  factory: "0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59",
  blockNumber: 131_000_000,
  txHash: "0x",
  logIndex: 0,
  launchId: 1n,
  token: "0x1111111111111111111111111111111111111111",
  curve: "0x2222222222222222222222222222222222222222",
  creator: "0x3333333333333333333333333333333333333333",
  quoteCurrency: null,
  initialBuy: 51_397_000_000_000_000n,
  metadataURI: "",
  quoted: false,
  name: "Render Check",
  symbol: "RCHK",
  transfersUnlocked: false,
  state,
  v6: null,
  totalSupply: ETH_PAIR.totalSupply,
  curveTokensRemaining: 0n,
  spotPriceWad: null,
  fdvWei: null,
  graduated: false,
  launchTimestamp: Math.floor(Date.now() / 1000) - 120,
  progressBps: 100,
  priceSource: "state" as const,
  curveKind: "classic" as const,
  enrichmentError: null,
};

const detailHtml = renderToStaticMarkup(
  createElement(TokenDetail, {
    row: detailRow,
    metadata: null,
    onClose: () => undefined,
  }),
);
check("TokenDetail renders", detailHtml.includes("Render Check") && detailHtml.includes("Model vs contract"));

// ---------- 2. simulator math against independently derived values ----------
const projection = projectLaunch(cfg, ETH_PAIR.totalSupply);

// Derived from live chain state (head ~131.7M) with exact integer arithmetic:
//   k = virtualEth * virtualToken, X0 = k / E0 = 1.073e9 tokens
//   tokens sold at graduation = X0 - k/(E0 + 5 ETH) = 793.1M
check(
  "tokens sold at graduation ≈ 793.1M",
  Math.abs(Number(soldAtGraduation(cfg)) / 1e24 - 793.1) < 0.5,
  `${(Number(soldAtGraduation(cfg)) / 1e24).toFixed(2)}M`,
);
check(
  "launch price ≈ 1.6445e-9 ETH",
  Math.abs(Number(projection.priceAtLaunch) - 1_644_542_990) < 5_000,
  `${projection.priceAtLaunch} wei`,
);
check(
  "graduation price ≈ 2.4168e-8 ETH",
  Math.abs(Number(projection.priceAtGraduation) - 24_167_897_923) < 1e7,
  `${projection.priceAtGraduation} wei`,
);
check(
  "launch → graduation multiple ≈ 14.7x",
  Math.abs(projection.multiple - 14.6958) < 0.05,
  `${projection.multiple.toFixed(4)}x`,
);

// A full curve: pushing exactly the gross amount needed to graduate must complete it.
const afterOpen = cfg.initialBuy > 0n ? buy(freshState({ ...cfg, initialBuy: 0n }), cfg.initialBuy).next : freshState(cfg);
const netNeeded = cfg.target - afterOpen.realEth;
const grossNeeded = (netNeeded * 10_000n) / (10_000n - cfg.feeBps) + 1n;
const completing = buy(afterOpen, grossNeeded);
check("the buy that fills the target completes the curve", completing.completesGraduation);
check(
  "curve completes within one wei of the target",
  completing.next.realEth >= cfg.target && completing.next.realEth - cfg.target < 2n,
  `overshoot ${completing.next.realEth - cfg.target} wei`,
);
const feeRatio = Number(completing.creatorFee) / Number(completing.protocolFee);
check(
  "creator gets 75% of the fees (creator:protocol = 3:1)",
  Math.abs(feeRatio - 3) < 0.0001,
  `${feeRatio.toFixed(5)}x (integer division loses a few wei)`,
);

// ---------- 3. number formatting: decimals, never engineering notation ----------
check("price 1.464e-9 renders as decimals", fmtPrice(1_464_000_000n) === "0.000000001464", fmtPrice(1_464_000_000n));
check("price 1.6445e-9 rounds to 4 significant digits", fmtPrice(1_644_542_990n) === "0.000000001645", fmtPrice(1_644_542_990n));
check("price 2.7 renders as a plain decimal", fmtPrice(2_700_000_000_000_000_000n) === "2.7", fmtPrice(2_700_000_000_000_000_000n));
check("small ETH amounts render as decimals", fmtEth(46_800_000_000_000n) === "0.0000468", fmtEth(46_800_000_000_000n));
check("ordinary ETH amounts keep their grouping", fmtEth(513_000_000_000_000_000n) === "0.513", fmtEth(513_000_000_000_000_000n));
check("no output anywhere contains an exponent", ![fmtPrice(1_464_000_000n), fmtPrice(1_644_542_990n), fmtEth(46_800_000_000_000n), fmtEth(1n), fmtEth(10n ** 9n)].some((s) => s.includes("e-") || s.includes("e+")));

// ---------- 4. hostile metadata must never crash a render ----------
// Regression: an IPFS metadata document whose `image` is an array (not a string)
// reached `.startsWith` and blanked the whole feed. Reproduce that shape here.
const hostileRaw = {
  name: ["Nested Name"],
  description: { text: "an object, not a string" },
  image: ["ipfs://bafkreihostile1", "ipfs://bafkreihostile2"],
  website: { url: "https://example.com" },
  twitter: 12345,
  properties: { image: "ipfs://bafkreifromproperties" },
};

check("sanitizeMetadata coerces an array image to its first string", sanitizeMetadata(hostileRaw)?.image === "ipfs://bafkreihostile1");
check("sanitizeMetadata drops an object description", sanitizeMetadata(hostileRaw)?.description === undefined);
check("sanitizeMetadata falls back to properties.image", sanitizeMetadata({ properties: { image: "ipfs://x" } })?.image === "ipfs://x");
check("sanitizeMetadata turns a numeric twitter into a string", sanitizeMetadata(hostileRaw)?.twitter === "12345");
check("sanitizeMetadata survives a non-object document", sanitizeMetadata("not json") === null && sanitizeMetadata(null) === null);

let avatarThrew = "";
for (const bad of [["ipfs://a", "ipfs://b"], { uri: "ipfs://c" }, 42, null, undefined]) {
  try {
    renderToStaticMarkup(createElement(TokenAvatar, { name: "Hostile", imageUri: bad as unknown as string }));
  } catch (e) {
    avatarThrew = String(e).slice(0, 120);
  }
}
check("TokenAvatar survives non-string image values", avatarThrew === "", avatarThrew);

let detailThrew = "";
try {
  renderToStaticMarkup(
    createElement(TokenDetail, {
      row: { ...detailRow, metadataURI: "ipfs://hostile" },
      metadata: hostileRaw as unknown as ProjectMetadata,
      onClose: () => undefined,
    }),
  );
} catch (e) {
  detailThrew = String(e).slice(0, 120);
}
check("TokenDetail survives hostile metadata fields", detailThrew === "", detailThrew);

// ---------- 5. window presets mean what they say ----------
check("1 hour converts at the measured block time", blocksForHours(1) === 24_000, `${blocksForHours(1)} blocks`);
check("1 day is 24× the hourly window", blocksForHours(24) === 576_000, `${blocksForHours(24)} blocks`);
check("7 days is 168× the hourly window", blocksForHours(168) === 4_032_000, `${blocksForHours(168)} blocks`);
check(
  "the earliest factory deployment is the 'all' floor",
  EARLIEST_DEPLOYMENT_BLOCK === 95_916_239,
  String(EARLIEST_DEPLOYMENT_BLOCK),
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
