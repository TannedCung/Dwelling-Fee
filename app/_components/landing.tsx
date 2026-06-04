import Link from "next/link";
import "../landing.css";

/**
 * Public marketing landing page (served at `/` to unauthenticated visitors and
 * crawlers). Static, semantic, server-rendered for SEO — ported from the
 * Dwelling Fee design system "Landing Page.html". Styles live in landing.css
 * (scoped under `.lp`); design tokens come from globals.css.
 */

const stroke = (sw = 1.75) =>
  ({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  });

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Dwelling Fee",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Real Estate Intelligence",
  operatingSystem: "Web",
  description:
    "A housing-price intelligence system that collects fragmented price signals — broker chat, web listings, screenshots — and turns them into structured, queryable market intelligence with provenance and confidence on every fact.",
  url: "https://dwelling-fee.vercel.app/",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Extract structured facts from messy multilingual broker messages",
    "Resolve observations to the same property entity",
    "Statistically honest price distributions with sample-size guards",
    "Provenance and confidence on every data point",
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Where does the price data come from?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "From the signals you already have — broker messages on Zalo, Messenger and SMS, web listings, and screenshots. Each is stored verbatim, then extracted into structured price observations that link back to the original text.",
      },
    },
    {
      "@type": "Question",
      name: "How does Dwelling Fee handle asking versus transacted prices?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It never mixes them. Distributions are segmented by listing type and deal status, because a median that silently blends rent, asking and transacted prices is confidently wrong.",
      },
    },
    {
      "@type": "Question",
      name: "Can I trust a single number from the tool?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Dwelling Fee never shows a single confident number. It shows distributions — median with an interquartile range — and flags segments with too few observations as underpowered.",
      },
    },
    {
      "@type": "Question",
      name: "Does it work with Vietnamese broker shorthand?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Extraction understands real broker shorthand such as 2PN (two bedrooms), tỷ (billion VND), sổ hồng (land title) and TL (negotiable), turning abbreviated chatter into correct structured facts.",
      },
    },
  ],
};

export function Landing() {
  return (
    <div className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ── Header ── */}
      <header className="site">
        <div className="wrap nav-inner">
          <a href="#top" aria-label="Dwelling Fee home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wordmark.svg" alt="Dwelling Fee" height={34} width={176} />
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#problems">What&apos;s hard</a>
            <a href="#provenance">Provenance</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-cta">
            <Link className="btn btn-ghost" href="/signin">
              Sign in
            </Link>
            <Link className="btn btn-primary" href="/ingest">
              Start with a message
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ── Hero ── */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <span className="eyebrow">Housing price intelligence</span>
              <h1 className="display" id="hero-title">
                Know what a home is <em>actually</em> worth.
              </h1>
              <p className="lede">
                Dwelling Fee collects the fragmented price signals you already have — broker chat, listings, screenshots — and
                turns them into structured, queryable market intelligence. Every fact links back to its raw text and carries a
                confidence score.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary btn-lg" href="/ingest">
                  Paste a broker message
                </Link>
                <a className="btn btn-ghost btn-lg" href="#how">
                  See how it works
                </a>
              </div>
              <p className="hero-note">
                <svg {...stroke()} width="15" height="15">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                No single confident numbers — only honest distributions.
              </p>
            </div>

            {/* On-brand product preview: a property living page */}
            <div
              className="preview-card"
              role="img"
              aria-label="Property living page preview for Vinhomes Grand Park, showing a price-per-square-metre distribution with median and interquartile range"
            >
              <div className="float-chip tl">
                <span className="dot" style={{ background: "var(--success)" }} />
                conf 92%
              </div>
              <div className="float-chip br">n = 14 observations</div>

              <div className="pc-head">
                <div>
                  <h3 className="pc-name">Vinhomes Grand Park</h3>
                  <p className="pc-sub">apartment · Quận 9 · living page</p>
                </div>
                <span className="badge sage">resolved</span>
              </div>

              <div className="pc-stat">
                <span className="pc-num">3.2M</span>
                <span className="pc-meta">₫/m² median · IQR 2.8–3.6M</span>
              </div>

              <div className="chart-well">
                <svg viewBox="0 0 320 132" width="100%" height="132" role="presentation" aria-hidden="true">
                  <rect x="0" y="40" width="320" height="46" fill="var(--viz-band)" rx="6" />
                  <line x1="0" y1="60" x2="320" y2="60" stroke="var(--cocoa)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.6" />
                  <line x1="0" y1="20" x2="320" y2="20" stroke="var(--clay-soft)" strokeWidth="1" />
                  <line x1="0" y1="106" x2="320" y2="106" stroke="var(--clay-soft)" strokeWidth="1" />
                  <circle cx="22" cy="72" r="5" fill="var(--viz-broker)" opacity="0.9" />
                  <circle cx="54" cy="54" r="5" fill="var(--viz-web)" opacity="0.9" />
                  <circle cx="86" cy="66" r="5" fill="var(--viz-broker)" opacity="0.9" />
                  <circle cx="116" cy="48" r="5" fill="var(--viz-agent)" opacity="0.9" />
                  <circle cx="146" cy="78" r="5" fill="var(--viz-web)" opacity="0.9" />
                  <circle cx="176" cy="58" r="5" fill="var(--viz-broker)" opacity="0.9" />
                  <circle cx="204" cy="44" r="5" fill="var(--viz-agent)" opacity="0.9" />
                  <circle cx="232" cy="70" r="5" fill="var(--viz-web)" opacity="0.9" />
                  <circle cx="260" cy="52" r="5" fill="var(--viz-broker)" opacity="0.9" />
                  <circle cx="290" cy="64" r="5" fill="var(--viz-agent)" opacity="0.9" />
                </svg>
                <div className="chart-cap">
                  <span>price / m²</span>
                  <span>median · IQR p25–p75</span>
                </div>
              </div>

              <div className="prov">
                <svg {...stroke()}>
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span>
                  <b>&ldquo;Bán 2PN, 60m², 3.2 tỷ, sổ hồng. TL.&rdquo;</b> → click any point for the raw signal.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Source strip ── */}
        <div className="sources">
          <div className="wrap">
            <p className="sources-label">Built for the messiness of real price signals — wherever they live</p>
            <div className="source-row">
              <span className="source-pill">
                <svg {...stroke()}>
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                </svg>
                Broker chat
              </span>
              <span className="source-pill">Zalo</span>
              <span className="source-pill">Messenger</span>
              <span className="source-pill">SMS</span>
              <span className="source-pill">
                <svg {...stroke()}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
                </svg>
                Web listings
              </span>
              <span className="source-pill">
                <svg {...stroke()}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
                </svg>
                Screenshots
              </span>
            </div>
          </div>
        </div>

        {/* ── Thesis / honesty ── */}
        <section aria-labelledby="thesis-title">
          <div className="wrap">
            <div className="thesis">
              <span className="eyebrow">Why it&apos;s different</span>
              <blockquote id="thesis-title">
                A median that silently mixes rent, asking and transacted prices is <em>confidently wrong.</em> Dwelling Fee
                refuses to do that.
              </blockquote>
              <cite>The product&apos;s defining trait: intellectual honesty over a single confident number.</cite>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how" aria-labelledby="how-title">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">How it works</span>
              <h2 className="sec-title" id="how-title">
                From a pasted message to queryable intelligence
              </h2>
              <p className="sec-sub">
                Four surfaces, one pipeline. Messy text goes in; structured, provenance-backed market facts come out.
              </p>
            </div>
            <div className="steps">
              <article className="step">
                <div className="step-n">01</div>
                <div className="step-icon">
                  <svg {...stroke()}>
                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                    <path d="M15 2v5h5" />
                    <path d="M9 13h6M9 17h4" />
                  </svg>
                </div>
                <h3>Ingest</h3>
                <p>
                  Paste a broker message. It&apos;s stored verbatim, then extracted into structured price observations.
                  Low-confidence extractions are flagged.
                </p>
              </article>
              <article className="step">
                <div className="step-n">02</div>
                <div className="step-icon">
                  <svg {...stroke()}>
                    <path d="m9 11 3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <h3>Review</h3>
                <p>
                  A human-in-the-loop queue. Link an ambiguous observation to a candidate property, create a new one, or
                  dismiss it — your call.
                </p>
              </article>
              <article className="step">
                <div className="step-n">03</div>
                <div className="step-icon">
                  <svg {...stroke()}>
                    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                    <path d="M6 12h12M6 8h12M6 16h12" />
                  </svg>
                </div>
                <h3>Properties</h3>
                <p>
                  Resolved entities become living pages that aggregate every observation over time — a price scatter and an
                  honest IQR distribution per property.
                </p>
              </article>
              <article className="step">
                <div className="step-n">04</div>
                <div className="step-icon">
                  <svg {...stroke()}>
                    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
                    <path d="m7 14 3-4 3 2 4-5" />
                  </svg>
                </div>
                <h3>Analytics</h3>
                <p>
                  Price/m² distributions, segmented by listing type and deal status — never mixed. Segments with n &lt; 5 are
                  flagged as underpowered.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ── Hard problems ── */}
        <section id="problems" aria-labelledby="problems-title">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The real work</span>
              <h2 className="sec-title" id="problems-title">
                The hard problems aren&apos;t CRUD
              </h2>
              <p className="sec-sub">
                Anyone can store a row. Dwelling Fee is built around the three things that actually make housing data
                trustworthy.
              </p>
            </div>
            <div className="problems">
              <article className="problem">
                <div className="step-icon">
                  <svg {...stroke()}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 2v6h6" />
                    <path d="m9 15 2 2 4-4" />
                  </svg>
                </div>
                <h3>Extraction</h3>
                <p>Turn messy, abbreviated, multilingual chatter into correct structured facts. The shorthand is the hard part:</p>
                <div className="kv">
                  <code>2PN = 2 beds</code>
                  <code>tỷ = billion ₫</code>
                  <code>sổ hồng = title</code>
                  <code>TL = negotiable</code>
                </div>
              </article>
              <article className="problem">
                <div className="step-icon">
                  <svg {...stroke()}>
                    <circle cx="18" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <path d="M6 21V9a9 9 0 0 0 9 9" />
                  </svg>
                </div>
                <h3>Entity resolution</h3>
                <p>
                  Decide whether two messages describe the <em>same</em> property — then merge their observations into one
                  living page instead of scattering duplicates.
                </p>
                <div className="kv">
                  <span className="badge warn">
                    <span className="dot" style={{ background: "var(--warning)" }} />
                    needs review
                  </span>
                  <span className="badge ok">
                    <span className="dot" style={{ background: "var(--success)" }} />
                    auto-link 92%
                  </span>
                </div>
              </article>
              <article className="problem">
                <div className="step-icon">
                  <svg {...stroke()}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </div>
                <h3>Statistical honesty</h3>
                <p>
                  Never mix rent, asking and transacted prices. Show distributions — median and IQR — with sample-size guards,
                  never a lone confident figure.
                </p>
                <div className="kv">
                  <code>median · IQR p25–p75</code>
                  <code>n &lt; 5 → underpowered</code>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── Provenance split ── */}
        <section id="provenance" aria-labelledby="prov-title">
          <div className="wrap split">
            <div>
              <span className="eyebrow">Trust, made visible</span>
              <h2 className="sec-title" id="prov-title">
                Every number traces back to where it came from
              </h2>
              <p className="sec-sub">
                Because the product is about honesty, trust is encoded in the interface itself — not buried in a methodology
                page.
              </p>
              <ul className="feat-list">
                <li>
                  <span className="fi">
                    <svg {...stroke(1.9)}>
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </span>
                  <div>
                    <b>Provenance on every fact</b>
                    <span>Click any data point to jump straight to the raw signal it was extracted from.</span>
                  </div>
                </li>
                <li>
                  <span className="fi">
                    <svg {...stroke(1.9)}>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4l3 2" />
                    </svg>
                  </span>
                  <div>
                    <b>Confidence, shown plainly</b>
                    <span>A small mono percentage and a sage→amber→terracotta dot. No hidden assumptions.</span>
                  </div>
                </li>
                <li>
                  <span className="fi">
                    <svg {...stroke(1.9)}>
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <path d="M12 9v4M12 17h.01" />
                    </svg>
                  </span>
                  <div>
                    <b>Caveats said out loud</b>
                    <span>
                      &ldquo;Only 3 sale observations — too few for a reliable estimate.&rdquo; Thin data is labelled, never
                      smoothed over.
                    </span>
                  </div>
                </li>
              </ul>
            </div>

            <div className="confidence-demo" aria-label="Three observations with their extracted price, segment and confidence">
              <div className="cd-row">
                <div className="cd-msg">
                  <span className="q">&ldquo;…3.2 tỷ, 60m², sổ hồng&rdquo;</span>
                  <br />
                  3.2M ₫/m² · sale · asking
                </div>
                <span className="badge ok">
                  <span className="dot" style={{ background: "var(--success)" }} />
                  92%
                </span>
              </div>
              <div className="cd-row">
                <div className="cd-msg">
                  <span className="q">&ldquo;cho thuê 12tr/tháng&rdquo;</span>
                  <br />
                  rent · transacted
                </div>
                <span className="badge warn">
                  <span className="dot" style={{ background: "var(--warning)" }} />
                  61%
                </span>
              </div>
              <div className="cd-row">
                <div className="cd-msg">
                  <span className="q">&ldquo;giá tốt, LH&rdquo;</span>
                  <br />
                  no price extracted
                </div>
                <span className="badge" style={{ background: "var(--danger-fill)", color: "var(--danger)" }}>
                  <span className="dot" style={{ background: "var(--danger)" }} />
                  38%
                </span>
              </div>
              <div className="prov" style={{ marginTop: 18 }}>
                <svg {...stroke()}>
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
                <span>
                  Low-confidence and unpriced signals are <b>excluded from analytics</b> until resolved.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" aria-labelledby="faq-title">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow">Questions</span>
              <h2 className="sec-title" id="faq-title">
                Honest answers
              </h2>
            </div>
            <div className="faq">
              <details className="qa" open>
                <summary>
                  Where does the price data come from?
                  <svg className="chev" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p>
                  From the signals you already have — broker messages on Zalo, Messenger and SMS, web listings, and
                  screenshots. Each is stored verbatim, then extracted into structured price observations that link back to the
                  original text.
                </p>
              </details>
              <details className="qa">
                <summary>
                  How do you handle asking versus transacted prices?
                  <svg className="chev" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p>
                  They&apos;re never mixed. Distributions are segmented by listing type and deal status, because a median that
                  silently blends rent, asking and transacted prices is confidently wrong.
                </p>
              </details>
              <details className="qa">
                <summary>
                  Can I trust a single number from the tool?
                  <svg className="chev" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p>
                  Dwelling Fee never shows a single confident number. It shows distributions — a median with an interquartile
                  range — and flags segments with too few observations as underpowered, so you always see how much data is
                  behind an estimate.
                </p>
              </details>
              <details className="qa">
                <summary>
                  Does it understand Vietnamese broker shorthand?
                  <svg className="chev" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p>
                  Yes. Extraction reads real shorthand such as 2PN (two bedrooms), tỷ (billion VND), sổ hồng (land title) and TL
                  (negotiable), turning abbreviated chatter into correct structured facts.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* ── CTA band ── */}
        <section id="cta" aria-labelledby="cta-title">
          <div className="wrap">
            <div className="cta-band">
              <h2 id="cta-title">Start with a single message</h2>
              <p>
                Paste one broker message and watch it become a structured, provenance-backed price observation. No
                spreadsheets, no guesswork — just honest housing-price intelligence.
              </p>
              <div className="cta-actions">
                <Link className="btn btn-primary btn-lg" href="/ingest">
                  Paste a broker message
                </Link>
                <a className="btn btn-secondary btn-lg" href="#how">
                  See a sample living page
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="site">
        <div className="wrap">
          <div className="foot-grid">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wordmark.svg" alt="Dwelling Fee" height={32} width={165} />
              <p className="foot-blurb">
                A housing-price intelligence system. Entity-based wiki, structured database and a spatiotemporal analytics
                layer — built so a buyer can reason about what a home is actually worth.
              </p>
            </div>
            <div className="foot-col">
              <h4>Product</h4>
              <ul>
                <li><a href="#how">Ingest</a></li>
                <li><a href="#how">Review queue</a></li>
                <li><a href="#how">Living pages</a></li>
                <li><a href="#how">Analytics</a></li>
              </ul>
            </div>
            <div className="foot-col">
              <h4>Approach</h4>
              <ul>
                <li><a href="#problems">Extraction</a></li>
                <li><a href="#problems">Entity resolution</a></li>
                <li><a href="#provenance">Statistical honesty</a></li>
                <li><a href="#faq">FAQ</a></li>
              </ul>
            </div>
            <div className="foot-col">
              <h4>Roadmap</h4>
              <ul>
                <li><a href="#cta">Geocoding &amp; heatmaps</a></li>
                <li><a href="#cta">Collection agent</a></li>
                <li><a href="#cta">Valuation alerts</a></li>
              </ul>
            </div>
          </div>
          <div className="foot-bottom">
            <p>© 2026 Dwelling Fee. Median · IQR · provenance on every number.</p>
            <p>Made with calm rigor — not hype.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
