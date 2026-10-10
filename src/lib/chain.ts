import { parseAbi } from "viem";

/**
 * Robinhood Chain Testnet + vibe/vibe protocol constants.
 *
 * PROVENANCE (important: this tool is only as good as these numbers)
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
 *    will be missed. That limitation is real and stated in the UI.
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

/** ~0.15s per block measured on chain, used for time estimates in the UI. */
export const BLOCK_SECONDS = 0.15;

/** Blocks for a given number of hours at the measured block time. */
export function blocksForHours(hours: number): number {
  return Math.round((hours * 3600) / BLOCK_SECONDS);
}

export type Generation = "retired" | "legacy" | "current" | "v6";

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
    netGraduationTarget: 5_000_000_000_000_000n, // 0.005 ETH, 1000x smaller than gen3
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
    netGraduationTarget: null, // not independently verified, never assumed
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
    note: "The generation the operator's interface launched into before V6.",
  },
  {
    generation: "v6",
    label: "v6",
    // Discovered on-chain: every launch created today comes from here, and this
    // address is NOT in the operator's published config list.
    address: "0xe794217880011f9cA6961340eD5c16EC9559Fea0",
    deploymentBlock: 131_499_965,
    feeBps: null, // per-launch: readable as baseTaxBps() on the curve
    creatorShareBps: null,
    netGraduationTarget: 4_000_000_000_000_000_000n, // 4 ETH, observed on 2026-10-09
    initialVirtualEthReserve: null,
    supportsQuotes: false,
    note: "Newest generation. Emits a different, undocumented launch event and a renamed curve surface.",
  },
];

export const FACTORY_BY_ADDRESS = new Map<string, FactoryInfo>(
  FACTORIES.map((f) => [f.address.toLowerCase(), f]),
);

/** Earliest factory deployment: the floor for a scan of "everything". */
export const EARLIEST_DEPLOYMENT_BLOCK = Math.min(...FACTORIES.map((f) => f.deploymentBlock));

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

/** Event topic0 hashes: recovered from the frontend bundle, re-confirmed by decoding live logs. */
export const TOPICS = {
  TokenLaunched: "0x56eef5c350583250e71791d6d659f4d181796c9deb08b977252efc3995aa9279",
  TokenLaunchedQuoted: "0x34041bc557672fe6a73853ece671e7715108f75e25427bfddf3e2f8e2085a0e7",
  Bought: "0x8a5254432535d4192429d2cc163283a57784eac274295fcda17cc659c1ee414c",
  Sold: "0x917d0fe1b6c3328f12a0177d25bf1b7d9e963116addad0bfc06b0cdcb6427603",
  CurveCompleted: "0x654e1d49372e305713e05ff2ed090670dd8683b365ce33618c15e187b875d21d",
  Graduated: "0xc1eaf6441a62895ddec3612cee606bd971cf6b1b38dd700f103e7b6b94167d0c",
  /**
   * V6 launch event. Unlike everything above this was NOT in the frontend bundle
   * and is not in 4byte.directory. It was recovered by decoding live logs emitted
   * by the V6 factory. Its layout is positional, see decodeV6Launch().
   */
  V6Launched: "0xa7e8032bfd07a9fbcde50eabe91eb2901faee6dbddd9cced579491d9b07ef5c8",
  /**
   * The other event the V6 factory emits, ~1:1 with launches. It is NOT a launch
   * event: 3 topics / 1 word, and the positional launch decoder fails on it by
   * design. Named here so the classifier can ignore it knowingly rather than
   * treating it as a decode failure.
   */
  V6PerLaunchOther: "0x5e4996fc710ab2bf894de604570b39df292e3629ba35a424cd622f8da787e537",
} as const;

/**
 * V6 launch log layout, recovered from a live log:
 *
 *   topic1 = launchId (uint)      topic2 = projectTreasury (address)   topic3 = token (address)
 *   word[0] = curve (address)     word[1] = offset to name            word[2] = offset to symbol
 *   word[3] = offset to metadataURI   word[4] = pairCurrency (0 = native)
 *   word[5] = baseTaxBps          word[8] = targetPairUnits           word[13] = metadata schema
 *
 * The three dynamic strings are what makes this event impossible to signature-match:
 * it carries the token's name and symbol on-chain, not just a metadata pointer.
 */
export const V6_WORD = {
  curve: 0,
  nameOffset: 1,
  symbolOffset: 2,
  uriOffset: 3,
  pairCurrency: 4,
  baseTaxBps: 5,
  targetPairUnits: 8,
  schemaVersion: 13,
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
  "function totalSupply() view returns (uint256)",
]);

/**
 * V6 curve surface. Renamed relative to the older generations: the reserve and
 * price getters (`virtualEthReserve`, `virtualTokenReserve`, `spotPriceWad`,
 * `fdvWei`) simply do not exist on a V6 curve and revert, while `pairPrincipal`
 * (raised), `targetPairUnits`, `sold`, `baseTaxBps`, `createdAt` and the decaying
 * `currentRateBps` do. Quotes go through `quoteBuyExactIn` / `quoteSell` instead
 * of `quoteBuy`.
 */
export const V6_CURVE_ABI = parseAbi([
  "function pairPrincipal() view returns (uint256)",
  "function targetPairUnits() view returns (uint256)",
  "function sold() view returns (uint256)",
  "function baseTaxBps() view returns (uint256)",
  "function currentRateBps() view returns (uint256)",
  "function createdAt() view returns (uint256)",
  "function pairCurrency() view returns (address)",
  "function projectTreasury() view returns (address)",
  "function treasury() view returns (address)",
  "function locker() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function complete() view returns (bool)",
  "function token() view returns (address)",
  "function factory() view returns (address)",
  "function quoteBuyExactIn(uint256 amountIn) view returns (uint256 tokensOut)",
  "function quoteSell(uint256 amountIn) view returns (uint256)",
]);

export const V6_CURVE_READ_FNS = [
  "pairPrincipal",
  "targetPairUnits",
  "sold",
  "baseTaxBps",
  "createdAt",
  "complete",
] as const;
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
