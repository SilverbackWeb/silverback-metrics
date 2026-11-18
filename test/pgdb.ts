/** In-memory Postgres (PGlite) with the real migrations applied, standing in for Neon in tests. */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/db/schema";

export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  return db;
}
