import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { rawSignal, priceObservation } from "../db/schema";
import { PasteForm } from "./paste-form";

// Reads live data each request; no static prerender.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function recentSignals() {
  const db = getDb();
  return db
    .select({
      id: rawSignal.id,
      rawText: rawSignal.rawText,
      status: rawSignal.status,
      ingestedAt: rawSignal.ingestedAt,
      obsCount: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(rawSignal)
    .leftJoin(priceObservation, eq(priceObservation.rawSignalId, rawSignal.id))
    .groupBy(rawSignal.id)
    .orderBy(desc(rawSignal.ingestedAt))
    .limit(20);
}

export default async function Home() {
  let signals: Awaited<ReturnType<typeof recentSignals>> = [];
  let error: string | null = null;
  try {
    signals = await recentSignals();
  } catch (e) {
    error = e instanceof Error ? e.message : "database unavailable";
  }

  return (
    <main style={{ display: "grid", gap: 24 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>Dwelling Fee</h1>
        <p style={{ color: "#666", margin: 0 }}>
          Paste a broker message — it&apos;s stored verbatim, then extracted into structured price
          observations. Low-confidence extractions are flagged for review.
        </p>
      </header>

      <PasteForm />

      <section>
        <h2 style={{ fontSize: 18 }}>Recent signals</h2>
        {error ? (
          <p style={{ color: "#b00" }}>
            Database not reachable ({error}). Set <code>DATABASE_URL</code>, run{" "}
            <code>db/extensions.sql</code>, then <code>npm run db:push</code>.
          </p>
        ) : signals.length === 0 ? (
          <p style={{ color: "#888" }}>No signals yet — paste one above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {signals.map((s) => (
              <li key={s.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 13, color: "#888" }}>{s.status}</span>
                  <span style={{ fontSize: 13, color: "#888" }}>{s.obsCount} obs</span>
                </div>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{s.rawText}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
