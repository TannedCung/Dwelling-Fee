import { listReviewQueue, type ReviewItem } from "../../lib/review";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const vnd = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + " ₫";

export default async function ReviewPage() {
  let items: ReviewItem[] = [];
  let error: string | null = null;
  try {
    items = await listReviewQueue();
  } catch (e) {
    error = e instanceof Error ? e.message : "database unavailable";
  }

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>Review queue</h1>
        <p style={{ color: "#666", margin: 0 }}>
          Observations with low extraction confidence or an ambiguous property match. Link to a
          candidate, create a new property, or dismiss. Until resolved, these are excluded from analytics.
        </p>
      </header>

      {error ? (
        <p style={{ color: "#b00" }}>Database not reachable ({error}).</p>
      ) : items.length === 0 ? (
        <p style={{ color: "#888" }}>Nothing to review. 🎉</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
          {items.map((it) => (
            <li key={it.observationId} style={{ border: "1px solid #eee", borderRadius: 8, padding: 14, display: "grid", gap: 10 }}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{it.rawText}</p>
              <div style={{ fontSize: 13, color: "#444" }}>
                <strong>{it.extraction.name ?? "(no name)"}</strong> · {it.extraction.type} ·{" "}
                {it.extraction.listingType} · {vnd(it.priceVnd)}
                {it.extraction.areaM2 != null && ` · ${it.extraction.areaM2} m²`}
                {it.confidence != null && (
                  <span style={{ color: "#888" }}> · conf {(it.confidence * 100).toFixed(0)}%</span>
                )}
              </div>
              <ReviewActions observationId={it.observationId} candidates={it.candidates} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
