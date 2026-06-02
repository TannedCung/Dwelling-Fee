"use client";

/**
 * Dependency-free SVG price scatter with a p25–p75 distribution band and median
 * line — the primary view per design §9 (scatter + bands, never a line chart).
 * X = time, Y = price/m². Color encodes source type.
 */

export interface ScatterPoint {
  t: number; // epoch ms
  pricePerM2: number | null;
  sourceType: string;
  dealStatus: string;
}

interface Band {
  median: number | null;
  p25: number | null;
  p75: number | null;
}

const SOURCE_COLOR: Record<string, string> = {
  broker: "#2563eb",
  web: "#16a34a",
  agent: "#9333ea",
  user: "#ea580c",
};

const W = 720, H = 300, PAD = 48;

export function PriceScatter({ points, band }: { points: ScatterPoint[]; band?: Band }) {
  const pts = points.filter((p) => p.pricePerM2 != null) as (ScatterPoint & { pricePerM2: number })[];
  if (pts.length === 0) {
    return <p style={{ color: "#888" }}>No price/m² observations to plot yet.</p>;
  }

  const ts = pts.map((p) => p.t);
  const ys = pts.map((p) => p.pricePerM2);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const yMin = Math.min(...ys, band?.p25 ?? Infinity);
  const yMax = Math.max(...ys, band?.p75 ?? -Infinity);
  const tSpan = tMax - tMin || 1;
  const ySpan = yMax - yMin || 1;

  const x = (t: number) => PAD + ((t - tMin) / tSpan) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - yMin) / ySpan) * (H - 2 * PAD);
  const fmtM = (v: number) => `${(v / 1_000_000).toFixed(0)}M`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", border: "1px solid #eee", borderRadius: 8 }}>
      {/* distribution band */}
      {band?.p25 != null && band?.p75 != null && (
        <rect x={PAD} y={y(band.p75)} width={W - 2 * PAD} height={Math.max(0, y(band.p25) - y(band.p75))}
          fill="#3b82f6" opacity={0.08} />
      )}
      {band?.median != null && (
        <line x1={PAD} x2={W - PAD} y1={y(band.median)} y2={y(band.median)} stroke="#3b82f6" strokeDasharray="4 3" opacity={0.6} />
      )}
      {/* axes */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#ccc" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#ccc" />
      <text x={PAD} y={PAD - 12} fontSize={11} fill="#666">price/m² (VND)</text>
      <text x={PAD - 6} y={y(yMax)} fontSize={10} fill="#999" textAnchor="end">{fmtM(yMax)}</text>
      <text x={PAD - 6} y={y(yMin)} fontSize={10} fill="#999" textAnchor="end">{fmtM(yMin)}</text>
      <text x={PAD} y={H - PAD + 16} fontSize={10} fill="#999">{new Date(tMin).toLocaleDateString()}</text>
      <text x={W - PAD} y={H - PAD + 16} fontSize={10} fill="#999" textAnchor="end">{new Date(tMax).toLocaleDateString()}</text>
      {/* points */}
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.pricePerM2)} r={p.dealStatus === "transacted" ? 6 : 4}
          fill={SOURCE_COLOR[p.sourceType] ?? "#888"} opacity={0.75}
          stroke={p.dealStatus === "transacted" ? "#111" : "none"} strokeWidth={1}>
          <title>{`${fmtM(p.pricePerM2)}/m² · ${p.sourceType} · ${p.dealStatus}`}</title>
        </circle>
      ))}
    </svg>
  );
}
