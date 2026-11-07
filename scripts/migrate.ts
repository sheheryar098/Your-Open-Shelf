import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

/** Applies db/migrations/*.sql in order, once each. `--reset` drops everything first (development only). */
export async function migrate(connectionString: string, opts: { reset?: boolean; quiet?: boolean } = {}) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (opts.reset) {
      if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = path.resolve(__dirname, "..", "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        if (!opts.quiet) console.log(`applied ${f}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL ?? "postgres://yos:yos@localhost:5432/yos";
  migrate(url, { reset: process.argv.includes("--reset") })
    .then(() => console.log("migrations up to date"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
