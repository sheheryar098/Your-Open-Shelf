import { Client } from "pg";
import { migrate } from "../scripts/migrate";
import { seedReferenceData } from "../scripts/reference-data";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://yos:yos@localhost:5432/yos_test";
  await migrate(url, { reset: true, quiet: true });
  const c = new Client({ connectionString: url });
  await c.connect();
  await seedReferenceData(c);
  await c.end();
}
