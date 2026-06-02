"use client";

/**
 * Dependency-free SVG price scatter with a p25–p75 IQR band and median line —
 * the primary view per design §9 (scatter + bands, never a line chart).
 * X = time, Y = price/m². Color encodes source type; transacted points are
 * larger with a ring. Restyled with the warm, borderless brand tokens.
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
  broker: "var(--viz-broker)",
  web: "var(--viz-web)",
  agent: "var(--viz-agent)",
  user: "var(--viz-user)",
};

const W = 760,
  H = 320,
  PAD = 52;

export function PriceScatter({ points, band }: { points: ScatterPoint[]; band?: Band }) {
  const pts = points.filter((p) => p.pricePerM2 != null) as (ScatterPoint & { pricePerM2: number })[];
  if (pts.length === 0) {
    return <div className="empty">No price/m² observations to plot yet.</div>;
  }

  const ts = pts.map((p) => p.t);
  const ys = pts.map((p) => p.pricePerM2);
  const tMin = Math.min(...ts),
    tMax = Math.max(...ts);
  const yMin = Math.min(...ys, band?.p25 ?? Infinity);
  const yMax = Math.max(...ys, band?.p75 ?? -Infinity);
  const tSpan = tMax - tMin || 1;
  const ySpan = yMax - yMin || 1;

  const x = (t: number) => PAD + ((t - tMin) / tSpan) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - yMin) / ySpan) * (H - 2 * PAD);
  const fmtM = (v: number) => `${(v / 1_000_000).toFixed(0)}M`;
  const dt = (t: number) => new Date(t).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

  const present = Array.from(new Set(pts.map((p) => p.sourceType)));

  return (
    <div className="scatter-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* IQR band */}
        {band?.p25 != null && band?.p75 != null && (
          <rect
            x={PAD}
            y={y(band.p75)}
            width={W - 2 * PAD}
            height={Math.max(0, y(band.p25) - y(band.p75))}
            fill="var(--viz-band)"
            rx="8"
          />
        )}
        {/* median line */}
        {band?.median != null && (
          <>
            <line
              x1={PAD}
              x2={W - PAD}
              y1={y(band.median)}
              y2={y(band.median)}
              stroke="var(--clay)"
              strokeDasharray="5 4"
              strokeWidth="1.5"
              opacity="0.7"
            />
            <text x={W - PAD} y={y(band.median) - 7} fontSize="12" fill="var(--clay)" textAnchor="end" fontFamily="var(--font-mono)">
              median {fmtM(band.median)}
            </text>
          </>
        )}
        {/* axes (hairline, warm) */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--clay-soft)" strokeWidth="1.5" />
        <line x1={PAD} y1={PAD - 8} x2={PAD} y2={H - PAD} stroke="var(--clay-soft)" strokeWidth="1.5" />
        <text x={PAD} y={PAD - 18} fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-sans)">
          price/m² (VND)
        </text>
        <text x={PAD - 8} y={y(yMax) + 3} fontSize="11" fill="var(--ink-3)" textAnchor="end" fontFamily="var(--font-mono)">
          {fmtM(yMax)}
        </text>
        <text x={PAD - 8} y={y(yMin) + 3} fontSize="11" fill="var(--ink-3)" textAnchor="end" fontFamily="var(--font-mono)">
          {fmtM(yMin)}
        </text>
        <text x={PAD} y={H - PAD + 18} fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-mono)">
          {dt(tMin)}
        </text>
        <text x={W - PAD} y={H - PAD + 18} fontSize="11" fill="var(--ink-3)" textAnchor="end" fontFamily="var(--font-mono)">
          {dt(tMax)}
        </text>
        {/* points */}
        {pts.map((p, i) => {
          const transacted = p.dealStatus === "transacted";
          return (
            <circle
              key={i}
              cx={x(p.t)}
              cy={y(p.pricePerM2)}
              r={transacted ? 7 : 5}
              fill={SOURCE_COLOR[p.sourceType] ?? "var(--ink-3)"}
              opacity={0.78}
              stroke={transacted ? "var(--surface)" : "none"}
              strokeWidth="2"
            >
              <title>{`${fmtM(p.pricePerM2)}/m² · ${p.sourceType} · ${p.dealStatus}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="legend">
        {present.map((s) => (
          <span key={s} className="li">
            <span className="dot" style={{ background: SOURCE_COLOR[s] ?? "var(--ink-3)" }} />
            {s}
          </span>
        ))}
        <span className="li">
          <span className="dot" style={{ background: "var(--ink-3)", boxShadow: "0 0 0 2px var(--surface)" }} />
          transacted (ringed)
        </span>
      </div>
    </div>
  );
}
