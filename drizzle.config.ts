import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // postgis/vector live outside the public schema management; don't let drizzle drop them.
  extensionsFilters: ["postgis"],
});
