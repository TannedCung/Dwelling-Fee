import type { MetadataRoute } from "next";

const SITE_URL = "https://dwelling-fee.vercel.app";

// Only the public landing is indexable; the app surfaces are auth-gated and
// carry no SEO value.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/ingest", "/review", "/properties", "/map", "/collect", "/analytics", "/signin", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
