export function short(a?: string | null, size = 4): string {
  if (!a) return "-";
  return `${a.slice(0, 2 + size)}…${a.slice(-size)}`;
}

export function fmtEth(wei: bigint | null | undefined, dp = 4): string {
  if (wei === null || wei === undefined) return "-";
  const v = Number(wei) / 1e18;
  if (v === 0) return "0";
  if (Math.abs(v) < 0.0001) return toDecimals(v);
  return v.toLocaleString(undefined, { maximumFractionDigits: dp });
}

/**
 * Plain decimal expansion for very small numbers, with ~4 significant digits.
 *
 * Engineering notation (1.464e-9) is accurate but unreadable as a price; a token
 * price is conventionally read as 0.000000001464. Paired with fmtPrice/fmtEth so
 * nothing in the UI silently switches notation.
 */
export function toDecimals(v: number, sig = 4, maxDp = 18): string {
  if (!Number.isFinite(v)) return "-";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1) return v.toFixed(Math.min(4, maxDp)).replace(/\.?0+$/, "");
  const dp = Math.min(maxDp, Math.max(2, Math.ceil(-Math.log10(abs)) + (sig - 1)));
  return v
    .toFixed(dp)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** Price in quote per token, from an 18dp wad. Shown in full decimals. */
export function fmtPrice(wad: bigint | null | undefined): string {
  if (wad === null || wad === undefined) return "-";
  const v = Number(wad) / 1e18;
  if (v === 0) return "0";
  if (v >= 0.001) return v.toFixed(6).replace(/\.?0+$/, "");
  return toDecimals(v);
}

export function fmtTokens(tokens: bigint | null | undefined, dp = 2): string {
  if (tokens === null || tokens === undefined) return "-";
  const v = Number(tokens) / 1e18;
  if (v >= 1e6) return `${(v / 1e6).toFixed(dp)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(dp)}K`;
  return v.toFixed(dp);
}

export function pct(bps: number | null | undefined, dp = 1): string {
  if (bps === null || bps === undefined) return "-";
  return `${(bps / 100).toFixed(dp)}%`;
}

export function agoFromUnix(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  return duration(s);
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString();
}
