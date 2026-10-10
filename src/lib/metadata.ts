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
  // Measured: from a normal client, only pinata and filebase served a real CID while
  // ipfs.io, dweb.link, w3s.link and nftstorage.link all answered 403. Order is the
  // fallback chain, so the ones that actually work come first and a dead host costs
  // nothing on the common path. flk-ipfs.xyz was dropped after it stopped answering.
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://nftstorage.link/ipfs/",
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
    /* storage full or blocked: enrichment is optional */
  }
}

/**
 * Metadata is untrusted input: it is a JSON blob someone else wrote and uploaded
 * to IPFS. `image` in particular is published as a string by most projects, but
 * arrays and nested objects are common, and a non-string reaching a `.startsWith`
 * call took this app's whole UI down once. So every field is coerced here, at the
 * boundary, and the components never have to defend themselves.
 */
function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asString(item);
      if (s) return s;
    }
  }
  return undefined;
}

/**
 * The vibe/vibe launcher does not publish `image` as a string. It writes an object:
 *
 *   { uri: "ipfs://bafkrei...", mimeType: "image/webp", bytes: 8762, width: 512, height: 512 }
 *
 * A plain `asString` correctly refuses that shape, which is why every logo in the feed
 * silently fell back to initials. Accept the object and pull the URI out of it, along
 * with the other keys projects use for the same idea.
 */
function asImageUri(v: unknown): string | undefined {
  const direct = asString(v);
  if (direct) return direct;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asImageUri(item);
      if (s) return s;
    }
    return undefined;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const key of ["uri", "url", "gateway", "image", "imageUrl", "src"]) {
      const s = asString(o[key]);
      if (s) return s;
    }
  }
  return undefined;
}

/** First usable image URI across the shapes projects actually publish. */
function pickImage(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const s = asImageUri(c);
    if (s) return s;
  }
  return undefined;
}

/** Normalize a raw metadata document. Never throws, never returns non-strings. */
export function sanitizeMetadata(raw: unknown): ProjectMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const properties = (r.properties && typeof r.properties === "object" ? (r.properties as Record<string, unknown>) : {}) ?? {};
  /**
   * The launcher nests links under `socials`, e.g.
   *   { socials: { website: "https://...", twitter: "..." } }
   * so reading only top-level `website`/`twitter` means a token created on this launchpad
   * shows no links at all in the drawer. Unwrap it, then fall back to the flat keys.
   */
  const socials = (r.socials && typeof r.socials === "object" ? (r.socials as Record<string, unknown>) : {}) ?? {};
  return {
    name: asString(r.name) ?? asString(properties.name),
    symbol: asString(r.symbol) ?? asString(properties.symbol),
    description: asString(r.description) ?? asString(properties.description),
    image: pickImage(r.image, r.image_url, r.logo, r.imageUrl, properties.image),
    twitter:
      asString(r.twitter) ?? asString(r.x) ?? asString(socials.twitter) ?? asString(socials.x) ?? asString(properties.twitter),
    website:
      asString(r.website) ??
      asString(r.external_url) ??
      asString(socials.website) ??
      asString(socials.url) ??
      asString(properties.website),
    telegram: asString(r.telegram) ?? asString(socials.telegram) ?? asString(properties.telegram),
    discord: asString(r.discord) ?? asString(socials.discord) ?? asString(properties.discord),
    raw,
  };
}

/** Normalize a profile value into a real link: "vibevibefun" and "@vibevibefun" are handles,
 *  not paths, and a bare handle in an href resolves relative to our own site and 404s. */
export function socialHref(value: unknown, kind: "twitter" | "telegram"): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "").replace(/\s+/g, "");
  if (!handle) return undefined;
  return kind === "twitter" ? `https://x.com/${handle}` : `https://t.me/${handle}`;
}

export function cidOf(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri) return null;
  if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length);
  return null;
}

/** Ordered gateway URLs for an `ipfs://` or `https://` URI (images). */
export function gatewayUrls(uri: unknown): string[] {
  if (typeof uri !== "string" || !uri) return [];
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

/** Resolve a metadata URI through gateways in order. Never throws, always sanitized. */
export async function fetchMetadata(uri: string): Promise<ProjectMetadata | null> {
  if (typeof uri !== "string" || !uri) return null;
  const cid = cidOf(uri);
  if (!cid) {
    if (uri.startsWith("http")) {
      try {
        const r = await fetchWithTimeout(uri, 8000);
        if (r.ok) return sanitizeMetadata(await r.json());
      } catch {
        return null;
      }
    }
    return null;
  }
  const cached = cacheGet(cid);
  // Re-sanitize on read: the cache may hold entries written before the sanitizer
  // existed, and a stale hostile value must not reach the components either.
  if (cached !== undefined) return cached === null ? null : sanitizeMetadata(cached.raw ?? cached);

  for (const gw of GATEWAYS) {
    try {
      const r = await fetchWithTimeout(gw + cid, 8000);
      if (!r.ok) continue;
      const clean = sanitizeMetadata(await r.json());
      cacheSet(cid, clean);
      return clean;
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
