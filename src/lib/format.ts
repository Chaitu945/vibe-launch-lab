export function short(a?: string | null, size = 4): string {
  if (!a) return "-";
  return `${a.slice(0, 2 + size)}…${a.slice(-size)}`;
}

export function fmtEth(wei: bigint | null | undefined, dp = 4): string {
  if (wei === null || wei === undefined) return "-";
  const v = Number(wei) / 1e18;
  if (v === 0) return "0";
  if (Math.abs(v) < TINY_FLOOR) return fmtTiny(v);
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

/** Price in quote per token, from an 18dp wad. Compact once it gets unreadable. */
export function fmtPrice(wad: bigint | null | undefined): string {
  if (wad === null || wad === undefined) return "-";
  const v = Number(wad) / 1e18;
  if (v === 0) return "0";
  if (v < TINY_FLOOR) return fmtTiny(v);
  if (v >= 0.001) return v.toFixed(6).replace(/\.?0+$/, "");
  return toDecimals(v);
}

/** The exact decimal for a price, for tooltips and the detail drawer. */
export function fmtPriceFull(wad: bigint | null | undefined): string {
  if (wad === null || wad === undefined) return "-";
  const v = Number(wad) / 1e18;
  return v === 0 ? "0" : toDecimals(v);
}

/** Below this, a decimal price is more zeros than number and stops being scannable. */
export const TINY_FLOOR = 1e-6;

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/** 8 -> "₈", 17 -> "₁₇". How many zeros follow the decimal point. */
export function subscriptZeros(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[Number(d)])
    .join("");
}

/**
 * Compact notation for numbers too small to read as decimals.
 *
 *   0.000000001464  ->  0.₈1464
 *
 * The subscript is how many zeros follow the decimal point, so 0.₈1464 expands to
 * 0.000000001464. It is shorter than the decimal, and unlike engineering notation
 * (1.464e-9) it still shows the magnitude and the leading digits without the reader
 * having to decode an exponent. Only used below TINY_FLOOR; above that a decimal is
 * already readable.
 */
export function fmtTiny(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "-";
  if (v === 0) return "0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= TINY_FLOOR) return sign + toDecimals(abs, sig);
  // ceil(-log10) - 1 is the count of zeros between the point and the first digit
  // (floor() would be off by one on exact powers of ten: 1e-9 has eight zeros, not nine).
  const zeros = Math.ceil(-Math.log10(abs)) - 1;
  const mantissa = abs * Math.pow(10, zeros + 1);
  const digits = mantissa
    .toFixed(Math.max(0, sig - 1))
    .replace(/\.?0+$/, "")
    .replace(".", "");
  return `${sign}0.${subscriptZeros(zeros)}${digits}`;
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
