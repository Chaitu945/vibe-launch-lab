import { createPublicClient, http, getAddress } from "viem";
const c = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 30000 }) });
const curves = {
  "theirs 0xb36F19a0": "0xb36F19a0D8A94e2C21215dD8cCB46E6385E882A3",
  "earlier gen2 (EthMoon)": "0x09BeD5F046e5a9ae10c6dc50104071C76Cd26cad",
  "gen3 wave curve": "0x2d4b7deC1a509f5c242405d8Ed287486972308EE",
};
function selectors(code) {
  const s = new Set();
  const hex = code.slice(2);
  for (let i = 0; i + 10 <= hex.length; i += 2) {
    if (hex.slice(i, i + 2) === "63") s.add("0x" + hex.slice(i + 2, i + 10));
  }
  return s;
}
const out = {};
for (const [label, addr] of Object.entries(curves)) {
  const code = await c.getBytecode({ address: getAddress(addr) });
  out[label] = { bytes: (code.length - 2) / 2, selectors: selectors(code) };
  console.log(`${label}: ${out[label].bytes} bytes, ${out[label].selectors.size} PUSH4 selectors`);
}
const t = out["theirs 0xb36F19a0"].selectors;
const e = out["earlier gen2 (EthMoon)"].selectors;
const onlyTheirs = [...t].filter((x) => !e.has(x));
const onlyEarlier = [...e].filter((x) => !t.has(x));
console.log(`\ndifferent implementations: ${onlyTheirs.length} selectors only on theirs, ${onlyEarlier.length} only on the earlier curve`);
console.log("only on theirs (first 14):", onlyTheirs.slice(0, 14).join(" "));
console.log("only on earlier (first 8):", onlyEarlier.slice(0, 8).join(" "));
