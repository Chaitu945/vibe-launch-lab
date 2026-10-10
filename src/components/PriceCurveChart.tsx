import { fmtTiny } from "../lib/format";

interface Props {
  points: { raised: number; price: number }[];
  /** Optional marker: the net graduation target, in ETH. */
  target: number;
  height?: number;
}

/** Price vs quote-raised along the curve. Plain SVG, so it works with no data libs. */
export function PriceCurveChart({ points, target, height = 200 }: Props) {
  const width = 640;
  const pad = { l: 52, r: 16, t: 14, b: 26 };
  if (points.length === 0) return null;
  const maxR = Math.max(...points.map((p) => p.raised), target || 0) || 1;
  const maxP = Math.max(...points.map((p) => p.price)) || 1;
  const sx = (r: number) => pad.l + (r / maxR) * (width - pad.l - pad.r);
  const sy = (p: number) => height - pad.b - (p / maxP) * (height - pad.t - pad.b);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.raised).toFixed(2)},${sy(p.price).toFixed(2)}`).join(" ");
  const gradX = sx(Math.min(target, maxR));

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price versus quote raised along the bonding curve">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={width - pad.r} y1={sy(maxP * f)} y2={sy(maxP * f)} className="grid" />
          <text x={pad.l - 8} y={sy(maxP * f) + 4} className="axis-label" textAnchor="end">
            {fmtTiny(maxP * f, 2)}
          </text>
        </g>
      ))}
      <path d={path} className="curve-line" />
      {target > 0 && (
        <g>
          <line x1={gradX} x2={gradX} y1={pad.t} y2={height - pad.b} className="grad-line" />
          <text x={gradX - 6} y={pad.t + 12} className="axis-label grad-label" textAnchor="end">
            graduation {target} ETH
          </text>
        </g>
      )}
      <text x={width - pad.r} y={height - 6} className="axis-label" textAnchor="end">
        quote raised (ETH)
      </text>
      <text x={pad.l - 8} y={height - 6} className="axis-label" textAnchor="end">
        price
      </text>
    </svg>
  );
}
