import { mapPoints, pendingGeocodeCount, type MapPoint } from "../../lib/geo/backfill";
import { MapView } from "./map-view";
import { GeocodeButton } from "./geocode-button";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MapPage() {
  let points: MapPoint[] = [];
  let pending = 0;
  let error: string | null = null;
  try {
    [points, pending] = await Promise.all([mapPoints(), pendingGeocodeCount()]);
  } catch (e) {
    error = describeError(e, "map");
  }

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Map</div>
        <h1>Price map</h1>
        <p>
          Geocoded properties — marker color is median sale price/m² (low → high), heat shows density.
          Geocoding uses OpenStreetMap (cached, swappable for a stronger provider).
        </p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : (
        <section className="section" style={{ marginTop: 0 }}>
          <div className="card-row" style={{ marginBottom: 12 }}>
            <span className="muted mono">
              {points.length} mapped · {pending} pending geocode
            </span>
            {pending > 0 && <GeocodeButton />}
          </div>

          {points.length === 0 ? (
            <div className="empty">
              {pending > 0
                ? "No properties geocoded yet — click “Geocode pending” to place them on the map."
                : "No geocoded properties yet. Ingest some signals, then geocode."}
            </div>
          ) : (
            <MapView points={points} />
          )}
        </section>
      )}
    </main>
  );
}
