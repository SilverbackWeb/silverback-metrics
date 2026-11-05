import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Small pool per serverless instance (Vercel + Neon), same pattern as the Scorecard.
const g = globalThis as unknown as { _pool?: Pool };
const pool = (g._pool ??= new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, max: 3 }));
export const db = drizzle(pool, { schema });
export { schema };
