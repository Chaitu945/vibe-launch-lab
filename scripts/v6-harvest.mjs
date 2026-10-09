/**
 * Full-surface recovery: pull every frontend chunk, harvest every identifier,
 * build candidate signatures, and match them against the selectors present in
 * the deployed V6 curve's runtime bytecode.
 *
 *   node scripts/v6-harvest.mjs
 */
import { createPublicClient, http, getAddress, keccak256, stringToHex } from "viem";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const CHUNK_DIR = `${homedir()}\\AppData\\Local\\Temp\\allchunks`;
mkdirSync(CHUNK_DIR, { recursive: true });

const list = readFileSync(`${homedir()}\\AppData\\Local\\Temp\\chunklist.txt`, "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
console.log(`${list.length} chunks to fetch`);

async function grab(path) {
  const name = path.split("/").pop().trim();
  const dest = `${CHUNK_DIR}\\${name}`;
  if (existsSync(dest) && readFileSync(dest, "utf8").length > 100) return true;
  try {
    const r = await fetch(`https://testnet.vibevibe.fun${path}`, {
      signal: AbortSignal.timeout(25_000),
      headers: {
        // The site rejects clients without a browser-ish UA.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept: "*/*",
      },
    });
    if (!r.ok) {
      console.log(`  ${r.status} ${name}`);
      return false;
    }
    writeFileSync(dest, await r.text());
    return true;
  } catch (e) {
    console.log(`  ERR ${name} ${String(e).slice(0, 60)}`);
    return false;
  }
}

// bounded concurrency
let cursor = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < list.length) await grab(list[cursor++]);
  }),
);

const all = readdirSync(CHUNK_DIR);
console.log(`${all.length} chunks on disk`);

const names = new Set();
for (const f of all) {
  const txt = readFileSync(`${CHUNK_DIR}\\${f}`, "utf8");
  for (const m of txt.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]{2,40})"/g)) names.add(m[1]);
}
console.log(`identifiers harvested: ${names.size}`);

const client = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 30_000 }) });
function selectorsOf(code) {
  const set = new Set();
  const hex = code.slice(2);
  for (let i = 0; i + 10 <= hex.length; i += 2) {
    if (hex.slice(i, i + 2) === "63") set.add("0x" + hex.slice(i + 2, i + 10).toLowerCase());
  }
  return set;
}
const V6 = "0xb36F19a0D8A94e2C21215dD8cCB46E6385E882A3";
const OLD = "0x09BeD5F046e5a9ae10c6dc50104071C76Cd26cad";
const v6 = selectorsOf(await client.getBytecode({ address: getAddress(V6) }));
const old = selectorsOf(await client.getBytecode({ address: getAddress(OLD) }));

const shapes = ["()", "(uint256)", "(address)", "(uint256,uint256)", "(address,uint256)", "(address,address)"];
const map = new Map();
for (const n of names) {
  for (const shape of shapes) {
    const sig = `${n}${shape}`;
    const s = keccak256(stringToHex(sig)).slice(0, 10).toLowerCase();
    if (v6.has(s)) map.set(s, sig);
  }
}

const onlyV6 = [...v6].filter((s) => !old.has(s)).sort();
const resolved = onlyV6.filter((s) => map.has(s));
console.log(`\nV6-only selectors: ${onlyV6.length} · resolved with names: ${resolved.length}\n`);
for (const s of resolved) console.log(`  ${s}  ${map.get(s)}`);

const unresolved = onlyV6.filter((s) => !map.has(s));
console.log(`\nunresolved (${unresolved.length}): ${unresolved.join(" ")}`);
