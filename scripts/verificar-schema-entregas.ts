import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("Variáveis do Turso ausentes.");
  }

  const db = createClient({ url, authToken });

  try {
    const result = await db.execute(
      'PRAGMA table_info("CarregamentoItem")'
    );

    console.log("=== COLUNAS REAIS NO TURSO ===");
    for (const row of result.rows) {
      console.log(`${row.name} | ${row.type}`);
    }

    const indexes = await db.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'CarregamentoItem'"
    );

    console.log("\n=== ÍNDICES EXISTENTES ===");
    for (const row of indexes.rows) {
      console.log(`${row.name} | ${row.sql}`);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("Falha na consulta:", error.message);
  process.exitCode = 1;
});
