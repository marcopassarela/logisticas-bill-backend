import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("TURSO_DATABASE_URL e TURSO_AUTH_TOKEN devem estar configurados.");
}

const client = createClient({ url, authToken });
const schemaPath = resolve(process.cwd(), "scripts/turso-schema.sql");
const schema = await readFile(schemaPath, "utf8");
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean)
  .filter((statement) => !statement.startsWith("--"));

try {
  await client.batch(
    statements.map((sql) => ({ sql, args: [] })),
    "write",
  );
  console.log(`Schema Turso aplicado: ${statements.length} instruções.`);
} finally {
  client.close();
}
