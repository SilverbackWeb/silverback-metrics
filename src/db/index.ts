import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon's HTTP driver: no connection pool to manage, works inside Cloudflare Workers.
// The client is created lazily so the env var is read at request time.
let _db: ReturnType<typeof make> | undefined;
function make() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (Neon connection string).");
  return drizzle(neon(url), { schema });
}
export const db = new Proxy({} as ReturnType<typeof make>, {
  get(_t, prop) {
    _db ??= make();
    return Reflect.get(_db, prop, _db);
  },
});
export { schema };
