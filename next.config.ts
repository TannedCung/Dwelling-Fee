import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native deps (pg/postgis driver) must not be bundled into server components.
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
