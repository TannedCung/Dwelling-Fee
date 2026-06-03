/**
 * Dependency-free SVG charts for the analytics dashboard, ported from the
 * Dwelling Fee design system (charts.jsx). Pure presentational components — no
 * state — so they render as server components. All values are passed in VND and
 * formatted to "M" (millions) here.
 */

const M = (n: number) => `${(n / 1_000_000).toFixed(1)}`;
const Mi = (n: number) => `${Math.round(n / 1_000_000)}`;

export interface LineSeries {
  name: string;
  color: string;
  points: (number | null)[];
  fill?: boolean;
}

/** Multi-line time series (asking vs transacted); breaks the path across null gaps. */
export function LineChart({ series, xLabels, height = 300 }: { series: LineSeries[]; xLabels: string[]; height?: number }) {
  const W = 780;
  const H = height;
  const padL = 50;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const n = xLabels.length;
  const all = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  if (all.length === 0) return <div className="empty">No data for this period.</div>;
  let yMin = Math.min(...all);
  let yMax = Math.max(...all);
  const pad = (yMax - yMin || yMax || 1) * 0.18;
  yMin = Math.max(0, yMin - pad);
  yMax = yMax + pad;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - ((v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + (i / ticks) * (yMax - yMin));
  // path that lifts the pen across null gaps
  const path = (pts: (number | null)[]) =>
    pts
      .map((v, i) => (v == null ? "" : `${i && pts[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .join(" ")
      .trim();
  const showEvery = n > 8 ? 2 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`df-lg${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {tickVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--clay-soft)" strokeWidth="1" opacity={i === 0 ? 0 : 0.6} />
          <text x={padL - 8} y={y(v) + 3} fontSize="11" fill="var(--ink-3)" textAnchor="end" fontFamily="var(--font-mono)">
            {Mi(v)}M
          </text>
        </g>
      ))}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--clay-soft)" strokeWidth="1.5" />
      {series.map(
        (s, i) =>
          s.fill && (() => {
            // area only spans contiguous leading points; keep it simple — fill under the full line extent
            const xs = s.points.map((v, j) => (v == null ? null : j)).filter((j): j is number => j != null);
            if (xs.length < 2) return null;
            const d = `${path(s.points)} L${x(xs[xs.length - 1]!).toFixed(1)},${y(yMin).toFixed(1)} L${x(xs[0]!).toFixed(1)},${y(yMin).toFixed(1)} Z`;
            return <path key={`a${i}`} d={d} fill={`url(#df-lg${i})`} />;
          })(),
      )}
      {series.map((s, i) => (
        <path key={`l${i}`} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {series.map((s, i) =>
        s.points.map((v, j) =>
          v == null ? null : (
            <circle key={`d${i}-${j}`} cx={x(j)} cy={y(v)} r="3.2" fill="var(--surface)" stroke={s.color} strokeWidth="2">
              <title>{`${s.name} · ${xLabels[j]}: ${M(v)}M`}</title>
            </circle>
          ),
        ),
      )}
      {xLabels.map((l, i) =>
        i % showEvery === 0 ? (
          <text key={i} x={x(i)} y={H - padB + 18} fontSize="11" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--font-mono)">
            {l}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export interface RankedRowVM {
  label: string;
  value: number; // VND
  n: number;
  dim?: boolean;
}

/** Ranked horizontal bars (median by district); leader highlighted, thin samples dimmed. */
export function RankedBars({ rows }: { rows: RankedRowVM[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="rbars">
      {rows.map((r, i) => (
        <div key={i} className="rbar">
          <div className="rb-label">
            <span className="rb-name">{r.label}</span>
          </div>
          <div className="rb-track">
            <div
              className="rb-fill"
              style={{ width: `${(r.value / max) * 100}%`, background: i === 0 ? "var(--cocoa)" : "var(--clay)", opacity: r.dim ? 0.5 : 1 }}
            />
          </div>
          <div className="rb-end">
            <span className="rb-val">
              {M(r.value)}M<small>/m²</small>
            </span>
            <span className="rb-n mono">
              n={r.n}
              {r.dim && " ⚠"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vertical columns (monthly activity / volume). */
export function Columns({ data, color = "var(--sage-deep)", height = 180 }: { data: { label: string; value: number }[]; color?: string; height?: number }) {
  const W = 780;
  const H = height;
  const padB = 26;
  const padT = 10;
  const padL = 6;
  const padR = 6;
  const n = data.length;
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 6;
  const bw = (W - padL - padR) / n - gap;
  const showEvery = n > 8 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
      {data.map((d, i) => {
        const h = (d.value / max) * (H - padB - padT);
        const x = padL + i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={H - padB - h} width={bw} height={Math.max(2, h)} rx="4" fill={color} opacity={0.92}>
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text x={x + bw / 2} y={H - padB - h - 5} fontSize="10.5" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--font-mono)">
              {d.value}
            </text>
            {i % showEvery === 0 && (
              <text x={x + bw / 2} y={H - padB + 16} fontSize="11" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--font-mono)">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Distribution histogram with the median bucket emphasized. */
export function Histogram({ dist, color = "var(--clay)", height = 200 }: { dist: { lo: number; step: number; bins: number[] }; color?: string; height?: number }) {
  const W = 780;
  const H = height;
  const padB = 30;
  const padT = 14;
  const padL = 8;
  const padR = 8;
  const bins = dist.bins;
  const n = bins.length;
  const max = Math.max(...bins, 1);
  const gap = 5;
  const bw = (W - padL - padR) / n - gap;
  const total = bins.reduce((a, b) => a + b, 0);
  let cum = 0;
  let medIdx = 0;
  for (let i = 0; i < n; i++) {
    cum += bins[i]!;
    if (cum >= total / 2) {
      medIdx = i;
      break;
    }
  }
  const label = (i: number) => Mi(dist.lo + i * dist.step);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
      {bins.map((c, i) => {
        const h = (c / max) * (H - padB - padT);
        const x = padL + i * (bw + gap);
        const isMed = i === medIdx;
        return (
          <g key={i}>
            <rect x={x} y={H - padB - h} width={bw} height={Math.max(2, h)} rx="4" fill={isMed ? "var(--cocoa)" : color} opacity={isMed ? 1 : 0.5}>
              <title>{`${label(i)}–${label(i + 1)}M/m²: ${c} obs`}</title>
            </rect>
            <text x={x + bw / 2} y={H - padB - h - 5} fontSize="10.5" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--font-mono)">
              {c}
            </text>
            <text x={x + bw / 2} y={H - padB + 16} fontSize="10" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--font-mono)">
              {label(i)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
