import { parseAbi } from "viem";

/**
 * Robinhood Chain Testnet + vibe/vibe protocol constants.
 *
 * PROVENANCE (important — this tool is only as good as these numbers)
 * ------------------------------------------------------------------
 * The vibe/vibe contracts are NOT source-verified on the explorer and there is no
 * published ABI. Everything here was established from chain state plus the public
 * frontend bundle:
 *
 *  - Event topic hashes and ABI fragments: recovered from the shipped frontend
 *    bundle by the open-source indexer `itstorvian/vibevibe-testnet-indexer`
 *    (MIT), then re-confirmed here by decoding live logs.
 *  - Factory address book: the three generations below are the ones observed
 *    emitting `TokenLaunched` on chain. A future generation that is not listed
 *    will be missed — that limitation is real and stated in the UI.
 *  - Fee policy (125 bps, 75% creator / 25% protocol) and graduation target
 *    (5 ETH) are read live from each curve where possible; the constants below
 *    are defaults used only when a read fails.
 *
 * Verified against chain on 2026-10-09, head block ~131.7M.
 */

export const CHAIN = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  faucet: "https://faucet.testnet.chain.robinhood.com/",
  app: "https://testnet.vibevibe.fun",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const;

/** ~0.15s per block measured on chain — used for time estimates in the UI. */
export const BLOCK_SECONDS = 0.15;

export type Generation = "retired" | "legacy" | "current";

export interface FactoryInfo {
  generation: Generation;
  label: string;
  address: `0x${string}`;
  deploymentBlock: number;
  /** Verified fee policy. `null` = NOT verified; never substituted from another generation. */
  feeBps: bigint | null;
  creatorShareBps: bigint | null;
  netGraduationTarget: bigint | null;
  initialVirtualEthReserve: bigint | null;
  supportsQuotes: boolean;
  note: string;
}

export const FACTORIES: FactoryInfo[] = [
  {
    generation: "retired",
    label: "gen1",
    address: "0x4FEbC267e0C24440bcDEF72B5DBC5FE7BED091dF",
    deploymentBlock: 95_916_239,
    feeBps: 100n,
    creatorShareBps: 5_000n,
    netGraduationTarget: 5_000_000_000_000_000n, // 0.005 ETH — 1000x smaller than gen3
    initialVirtualEthReserve: 1_764_594_628_672_298n,
    supportsQuotes: false,
    note: "Delisted by the operator but still emitting launches when last checked on-chain (2026-09-13).",
  },
  {
    generation: "legacy",
    label: "gen2",
    address: "0xB5B7A2f6c4EAFa2D73918fcA32d50e2126339eb9",
    deploymentBlock: 108_435_450,
    feeBps: 125n,
    creatorShareBps: 7_500n,
    netGraduationTarget: null, // not independently verified — never assumed
    initialVirtualEthReserve: null,
    supportsQuotes: false,
    note: "Largest generation by launch count. Fee economics match the current one; graduation params unverified.",
  },
  {
    generation: "current",
    label: "gen3",
    address: "0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59",
    deploymentBlock: 115_025_604,
    feeBps: 125n,
    creatorShareBps: 7_500n,
    netGraduationTarget: 5_000_000_000_000_000_000n, // 5 ETH
    initialVirtualEthReserve: 1_764_594_628_672_298_575n,
    supportsQuotes: true,
    note: "The generation the operator's interface launches into today.",
  },
];

export const FACTORY_BY_ADDRESS = new Map<string, FactoryInfo>(
  FACTORIES.map((f) => [f.address.toLowerCase(), f]),
);

export function generationOf(address: string): FactoryInfo | null {
  return FACTORY_BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

/** ETH-paired launch curve, verified constants (see module header). */
export const ETH_PAIR = {
  /** Virtual token reserve at launch. Constant across generations. */
  initialVirtualTokenReserve: 1_073_000_000n * 10n ** 18n,
  initialVirtualEthReserve: 1_764_594_628_672_298_575n,
  initialVirtualEthReserveGen1: 1_764_594_628_672_298n,
  netGraduationTarget: 5n * 10n ** 18n,
  netGraduationTargetGen1: 5_000_000_000_000_000n,
  feeBps: 125n,
  feeBpsGen1: 100n,
  creatorShareBps: 7_500n,
  creatorShareBpsGen1: 5_000n,
  totalSupply: 10n ** 27n, // 1B @ 18dp
  curveAllocation: 8n * 10n ** 26n, // 800M tokens sellable from the curve
  graduatedLiquidity: 2n * 10n ** 26n, // 200M tokens to the locked pool
} as const;

/** Registered stock-pair quote asset (the only one on the on-chain quote registry). */
export const STOCK_QUOTE = {
  address: "0x5a5398155d98374c0e26265ea3cb9818169c2739",
  symbol: "SPCX",
  decimals: 18,
  initialVirtualReserve: 29_200_644_062_199_887_424n,
  netGraduationTarget: 82_740_374_439_909_720_323n,
  launchFee: 8_274_037_443_990_973n,
} as const;

/** Canonical ERC-20 pair route (V3 launches with a project tax). */
export const CANONICAL_PAIR = {
  token: "0x728E721256D0708D23b00afCD32c096979259b16",
  poolFeeBps: 3_000n,
  protocolSplit: "0x3b13605865D7164d1dfe2080E22910df3a701899",
  buybackExecutor: "0xC9975c306b0bB34a2732a7b96FED54fe8e0e7D29",
} as const;

/** Event topic0 hashes — recovered from the frontend bundle, re-confirmed by decoding live logs. */
export const TOPICS = {
  TokenLaunched: "0x56eef5c350583250e71791d6d659f4d181796c9deb08b977252efc3995aa9279",
  TokenLaunchedQuoted: "0x34041bc557672fe6a73853ece671e7715108f75e25427bfddf3e2f8e2085a0e7",
  Bought: "0x8a5254432535d4192429d2cc163283a57784eac274295fcda17cc659c1ee414c",
  Sold: "0x917d0fe1b6c3328f12a0177d25bf1b7d9e963116addad0bfc06b0cdcb6427603",
  CurveCompleted: "0x654e1d49372e305713e05ff2ed090670dd8683b365ce33618c15e187b875d21d",
  Graduated: "0xc1eaf6441a62895ddec3612cee606bd971cf6b1b38dd700f103e7b6b94167d0c",
} as const;

export const FACTORY_ABI = parseAbi([
  "event TokenLaunched(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)",
  "event TokenLaunchedQuoted(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, address quoteCurrency, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)",
  "function launchCount() view returns (uint256)",
]);

export const CURVE_ABI = parseAbi([
  "function virtualEthReserve() view returns (uint256)",
  "function virtualTokenReserve() view returns (uint256)",
  "function realEthReserve() view returns (uint256)",
  "function curveTokensRemaining() view returns (uint256)",
  "function tokensSoldFromCurve() view returns (uint256)",
  "function spotPriceWad() view returns (uint256)",
  "function fdvWei() view returns (uint256)",
  "function complete() view returns (bool)",
  "function graduated() view returns (bool)",
  "function launchTimestamp() view returns (uint256)",
  "function TOTAL_SUPPLY() view returns (uint256)",
  "function TOTAL_FEE_BPS() view returns (uint256)",
  "function NET_GRADUATION_TARGET() view returns (uint256)",
  "function INITIAL_VIRTUAL_ETH_RESERVE() view returns (uint256)",
  "function quoteCurrency() view returns (address)",
  "function quoteBuy(uint256 grossEth) view returns (uint256 tokenAmount, uint256 grossEthUsed, uint256 curveQuote, uint256 totalFee, uint256 refund)",
]);

export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfersUnlocked() view returns (bool)",
]);

/** Multicall-shaped read list used to enrich a launch row in one round trip. */
export const CURVE_READ_FNS = [
  "virtualEthReserve",
  "virtualTokenReserve",
  "realEthReserve",
  "curveTokensRemaining",
  "tokensSoldFromCurve",
  "spotPriceWad",
  "fdvWei",
  "complete",
  "launchTimestamp",
  "NET_GRADUATION_TARGET",
  "TOTAL_FEE_BPS",
] as const;
