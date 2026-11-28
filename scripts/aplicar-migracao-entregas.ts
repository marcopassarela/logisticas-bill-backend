import "dotenv/config";
import { createClient } from "@libsql/client";

const colunas = [
  ["entregaFotoPath", "TEXT"],
  ["entregaFotoNome", "TEXT"],
  ["entregaFotoCriadaEm", "DATETIME"],
  ["entregueEm", "DATETIME"],
  ["entregaObservacao", "TEXT"],
  ["entregaConfirmadaPorId", "TEXT"],
  ["entregaConfirmadaPorNome", "TEXT"],
] as const;

const indices = [
  {
    name: "CarregamentoItem_entregaFotoCriadaEm_idx",
    sql: 'CREATE INDEX "CarregamentoItem_entregaFotoCriadaEm_idx" ON "CarregamentoItem" ("entregaFotoCriadaEm")',
  },
  {
    name: "CarregamentoItem_entregue_entregueEm_idx",
    sql: 'CREATE INDEX "CarregamentoItem_entregue_entregueEm_idx" ON "CarregamentoItem" ("entregue", "entregueEm")',
  },
];

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("Variáveis do Turso ausentes.");
  }

  const db = createClient({ url, authToken });

  try {
    const tabela = await db.execute(
      'PRAGMA table_info("CarregamentoItem")'
    );

    const existentes = new Set(
      tabela.rows.map((row) => String(row.name))
    );

    if (!existentes.has("entregue")) {
      throw new Error(
        "A coluna entregue não existe. Migração interrompida."
      );
    }

    const indicesAtuais = await db.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'CarregamentoItem'"
    );

    const nomesIndices = new Set(
      indicesAtuais.rows.map((row) => String(row.name))
    );

    const comandos: string[] = [];

    for (const [nome, tipo] of colunas) {
      if (!existentes.has(nome)) {
        comandos.push(
          `ALTER TABLE "CarregamentoItem" ADD COLUMN "${nome}" ${tipo}`
        );
      }
    }

    for (const indice of indices) {
      if (!nomesIndices.has(indice.name)) {
        comandos.push(indice.sql);
      }
    }

    console.log("=== PLANO DE MIGRACAO ===");
    if (comandos.length === 0) {
      console.log("Todas as estruturas já existem.");
    } else {
      comandos.forEach((sql, i) => console.log(`${i + 1}. ${sql}`));
    }

    if (comandos.length > 0) {
      console.log("\nAplicando migração...");
      await db.batch(comandos, "write");
      console.log("Migração executada.");
    }

    const verificacao = await db.execute(
      'PRAGMA table_info("CarregamentoItem")'
    );

    const colunasFinais = new Set(
      verificacao.rows.map((row) => String(row.name))
    );

    const indicesFinais = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'CarregamentoItem'"
    );

    const nomesFinais = new Set(
      indicesFinais.rows.map((row) => String(row.name))
    );

    const faltandoColunas = colunas
      .map(([nome]) => nome)
      .filter((nome) => !colunasFinais.has(nome));

    const faltandoIndices = indices
      .map((indice) => indice.name)
      .filter((nome) => !nomesFinais.has(nome));

    console.log("\n=== RESULTADO FINAL ===");
    console.log("Colunas novas:");
    for (const [nome] of colunas) {
      console.log(`${colunasFinais.has(nome) ? "OK" : "FALTA"} | ${nome}`);
    }

    console.log("\nÍndices:");
    for (const indice of indices) {
      console.log(`${nomesFinais.has(indice.name) ? "OK" : "FALTA"} | ${indice.name}`);
    }

    if (faltandoColunas.length || faltandoIndices.length) {
      throw new Error("A verificação final encontrou estruturas ausentes.");
    }

    console.log("\nMIGRACAO VALIDADA COM SUCESSO.");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("\nERRO NA MIGRACAO:", error.message);
  process.exitCode = 1;
});
