import { createPublicClient, http, parseAbi, getAddress } from "viem";
const client = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 30000 }) });
const curveAbi = parseAbi([
  "function virtualEthReserve() view returns (uint256)","function virtualTokenReserve() view returns (uint256)",
  "function realEthReserve() view returns (uint256)","function spotPriceWad() view returns (uint256)",
  "function TOTAL_FEE_BPS() view returns (uint256)","function NET_GRADUATION_TARGET() view returns (uint256)",
  "function INITIAL_VIRTUAL_ETH_RESERVE() view returns (uint256)",
  "function quoteBuy(uint256 grossEth) view returns (uint256 tokenAmount, uint256 grossEthUsed, uint256 curveQuote, uint256 totalFee, uint256 refund)",
]);
const curves = ["0x09BeD5F046e5a9ae10c6dc50104071C76Cd26cad","0x4bBAE343ae561aA8be9bac73626D4d855f34D1cD","0x2d4b7deC1a509f5c242405d8Ed287486972308EE"];
const gross = 10n ** 16n;
for (const c of curves) {
  const addr = getAddress(c);
  const r = {};
  for (const fn of ["virtualEthReserve","virtualTokenReserve","realEthReserve","spotPriceWad","TOTAL_FEE_BPS","NET_GRADUATION_TARGET","INITIAL_VIRTUAL_ETH_RESERVE"]) {
    try { r[fn] = await client.readContract({ address: addr, abi: curveAbi, functionName: fn }); } catch (e) { r[fn] = null; }
  }
  let q = null; try { q = await client.readContract({ address: addr, abi: curveAbi, functionName: "quoteBuy", args: [gross] }); } catch (e) { q = "ERR"; }
  const vE = r.virtualEthReserve, vT = r.virtualTokenReserve;
  const k = vE * vT;
  const feeBps = r.TOTAL_FEE_BPS ?? 0n;
  const fee = gross * feeBps / 10000n;
  const net = gross - fee;
  const modelTokens = vT - (k / (vE + net));
  const modelPrice = (vE * 10n ** 18n) / vT;
  console.log(JSON.stringify({
    curve: addr, feeBps: String(feeBps), target: String(r.NET_GRADUATION_TARGET), e0: String(r.INITIAL_VIRTUAL_ETH_RESERVE),
    chain: { tokensOut: q === "ERR" ? "ERR" : q[0].toString(), curveQuote: q === "ERR" ? null : q[2].toString(), totalFee: q === "ERR" ? null : q[3].toString(), refund: q === "ERR" ? null : q[4].toString() },
    model: { tokensOut: modelTokens.toString(), fee: fee.toString() },
    deltaTokens: q === "ERR" ? null : (modelTokens - q[0]).toString(),
    spot_chain: String(r.spotPriceWad), spot_model: modelPrice.toString(), spot_delta: (modelPrice - r.spotPriceWad).toString(),
    realEth: String(r.realEthReserve),
  }, null, 1));
}
