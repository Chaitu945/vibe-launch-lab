export function short(a?: string | null, size = 4): string {
  if (!a) return "—";
  return `${a.slice(0, 2 + size)}…${a.slice(-size)}`;
}

export function fmtEth(wei: bigint | null | undefined, dp = 4): string {
  if (wei === null || wei === undefined) return "—";
  const v = Number(wei) / 1e18;
  if (v === 0) return "0";
  if (Math.abs(v) < 0.0001) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: dp });
}

/** Price in quote per token, from an 18dp wad. Values are ~1e-9, so render in scientific-ish form. */
export function fmtPrice(wad: bigint | null | undefined): string {
  if (wad === null || wad === undefined) return "—";
  const v = Number(wad) / 1e18;
  if (v === 0) return "0";
  if (v >= 0.001) return v.toFixed(6);
  return v.toExponential(3).replace("e-", "e-");
}

export function fmtTokens(tokens: bigint | null | undefined, dp = 2): string {
  if (tokens === null || tokens === undefined) return "—";
  const v = Number(tokens) / 1e18;
  if (v >= 1e6) return `${(v / 1e6).toFixed(dp)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(dp)}K`;
  return v.toFixed(dp);
}

export function pct(bps: number | null | undefined, dp = 1): string {
  if (bps === null || bps === undefined) return "—";
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
