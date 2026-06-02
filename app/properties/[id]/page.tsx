import Link from "next/link";
import { notFound } from "next/navigation";
import { getProperty } from "../../../lib/properties";
import { PriceScatter } from "../../_components/price-scatter";
import { MIN_SAMPLE } from "../../../lib/stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try {
    detail = await getProperty(id);
  } catch (e) {
    return <p style={{ color: "#b00" }}>Database not reachable ({e instanceof Error ? e.message : "error"}).</p>;
  }
  if (!detail) notFound();

  const d = detail.saleDistribution;

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}>
        <Link href="/properties">← Properties</Link>
      </p>
      <header>
        <h1 style={{ marginBottom: 4 }}>{detail.name ?? "(unnamed property)"}</h1>
        <p style={{ color: "#666", margin: 0 }}>
          {detail.type}
          {detail.addressText && ` · ${detail.addressText}`} · {detail.observations.length} observations
        </p>
      </header>

      <section style={{ display: "grid", gap: 6 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Sale price/m² distribution</h2>
        {d.n < MIN_SAMPLE ? (
          <p style={{ color: "#a60", fontSize: 13 }}>
            Only {d.n} sale observation(s) — too few for a reliable estimate (need ≥ {MIN_SAMPLE}).
          </p>
        ) : (
          <p style={{ fontSize: 14 }}>
            median <strong>{m(d.median)}</strong> · IQR {m(d.p25)}–{m(d.p75)} · n={d.n}
          </p>
        )}
      </section>

      <PriceScatter
        points={detail.observations.map((o) => ({
          t: o.t,
          pricePerM2: o.pricePerM2,
          sourceType: o.sourceType,
          dealStatus: o.dealStatus,
        }))}
        band={{ median: d.median, p25: d.p25, p75: d.p75 }}
      />
    </main>
  );
}
