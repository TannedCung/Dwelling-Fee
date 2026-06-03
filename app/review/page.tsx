import { listReviewQueue, type ReviewItem } from "../../lib/review";
import { ReviewActions } from "./review-actions";
import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const vnd = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + " ₫";

function ConfidenceBadge({ value }: { value: number }) {
  const cls = value >= 0.75 ? "committed" : value >= 0.5 ? "review" : "failed";
  const dot = value >= 0.75 ? "var(--success)" : value >= 0.5 ? "var(--warning)" : "var(--danger)";
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" style={{ background: dot }} />
      conf {(value * 100).toFixed(0)}%
    </span>
  );
}

function extractionTitle(extraction: ReviewItem["extraction"]): string {
  return [extraction.projectName, extraction.buildingName, extraction.houseNumber].filter(Boolean).join(" / ")
    || extraction.name
    || "(no name)";
}

export default async function ReviewPage() {
  let items: ReviewItem[] = [];
  let error: string | null = null;
  try {
    items = await listReviewQueue();
  } catch (e) {
    error = describeError(e, "review");
  }

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Review queue</div>
        <h1>Review queue</h1>
        <p>
          Observations with low extraction confidence or an ambiguous property match. Link to a
          candidate, create a new property, or dismiss. Until resolved, these are excluded from analytics.
        </p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : items.length === 0 ? (
        <div className="empty">
          <Icon name="check-circle" size={30} />
          Nothing to review — the queue is clear.
        </div>
      ) : (
        <div className="card-grid">
          {items.map((it) => (
            <div key={it.observationId} className="card review-item">
              <p className="raw">{it.rawText}</p>
              <div className="review-extract">
                <strong>{extractionTitle(it.extraction)}</strong>
                <span className="chip">{it.extraction.type}</span>
                <span className="chip">{it.extraction.listingType}</span>
                {it.extraction.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}
                <span className="mono">{vnd(it.priceVnd)}</span>
                {it.extraction.areaM2 != null && <span className="mono">{it.extraction.areaM2} m²</span>}
                {it.confidence != null && <ConfidenceBadge value={it.confidence} />}
              </div>
              <ReviewActions observationId={it.observationId} candidates={it.candidates} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
