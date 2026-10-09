/**
 * Project metadata lives on IPFS (`metadataURI` in the launch event).
 *
 * Reality check: public gateways rate-limit hard (429) and are slow, so metadata
 * is treated as a best-effort enrichment. On-chain ERC-20 `name`/`symbol` are the
 * authoritative identity of a launch and are always shown; the image/description
 * from IPFS are progressive enhancement with a monogram fallback.
 *
 * Everything is cached in localStorage so a paginated feed does not re-fetch the
 * same CID on every render.
 */

const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://flk-ipfs.xyz/ipfs/",
];

export interface ProjectMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  discord?: string;
  raw?: unknown;
}

interface CacheEntry {
  at: number;
  value: ProjectMetadata | null;
}

const CACHE_PREFIX = "vll:meta:";
const TTL_MS = 1000 * 60 * 60 * 24;

function cacheGet(key: string): ProjectMetadata | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.at > TTL_MS) return undefined;
    return parsed.value;
  } catch {
    return undefined;
  }
}

function cacheSet(key: string, value: ProjectMetadata | null) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value } satisfies CacheEntry));
  } catch {
    /* storage full or blocked — enrichment is optional */
  }
}

export function cidOf(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length);
  return null;
}

/** Ordered gateway URLs for an `ipfs://` or `https://` URI (images). */
export function gatewayUrls(uri: string): string[] {
  if (!uri) return [];
  if (uri.startsWith("http://") || uri.startsWith("https://")) return [uri];
  const cid = cidOf(uri);
  if (!cid) return [];
  return GATEWAYS.map((g) => g + cid);
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Resolve a metadata URI through gateways in order. Never throws. */
export async function fetchMetadata(uri: string): Promise<ProjectMetadata | null> {
  const cid = cidOf(uri);
  if (!cid) {
    if (uri.startsWith("http")) {
      try {
        const r = await fetchWithTimeout(uri, 8000);
        if (r.ok) return (await r.json()) as ProjectMetadata;
      } catch {
        return null;
      }
    }
    return null;
  }
  const cached = cacheGet(cid);
  if (cached !== undefined) return cached;

  for (const gw of GATEWAYS) {
    try {
      const r = await fetchWithTimeout(gw + cid, 8000);
      if (!r.ok) continue;
      const json = (await r.json()) as ProjectMetadata;
      cacheSet(cid, json);
      return json;
    } catch {
      continue;
    }
  }
  cacheSet(cid, null);
  return null;
}

/** Tiny concurrency pool so a feed of 40 rows doesn't open 40 sockets. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function monogram(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9 ]/g, "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}
