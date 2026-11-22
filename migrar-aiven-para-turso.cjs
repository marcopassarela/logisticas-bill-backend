
process.loadEnvFile(".env");
process.loadEnvFile(".env.turso");

const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaClient: TursoPrismaClient } = require("./src/generated/turso");
const { PrismaLibSQL } = require("@prisma/adapter-libsql");

const origem = new PrismaClient();

const destino = new TursoPrismaClient({
  adapter: new PrismaLibSQL({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  })
});

const modelos = [
  "Cargo",
  "Caminhao",
  "Funcionario",
  "User",
  "Session",
  "Carregamento",
  "CarregamentoItem",
  "Diaria",
  "Falta",
  "Lembrete",
  "ManutencaoProgramada",
  "PushSubscription",
  "Rota",
  "RotaPonto",
  "AgendamentoCarregamento",
  "Alerta",
  "AuditLog",
  "EnderecoFavorito"
];

function normalizar(v) {
  if (v instanceof Date) return { date: v.toISOString() };

  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    return { bytes: Buffer.from(v).toString("base64") };
  }

  if (typeof v === "bigint") return { bigint: v.toString() };

  if (v && typeof v.toFixed === "function" &&
      v.constructor?.name === "Decimal") {
    return { number: Number(Number(v.toString()).toFixed(12)) };
  }

  if (typeof v === "number") {
    return Number(v.toFixed(12));
  }

  if (Array.isArray(v)) return v.map(normalizar);

  if (v && typeof v === "object") {
    const result = {};
    for (const key of Object.keys(v).sort()) {
      result[key] = normalizar(v[key]);
    }
    return result;
  }

  return v;
}

function checksum(rows) {
  const ordenadas = [...rows].sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );

  return crypto.createHash("sha256")
    .update(JSON.stringify(ordenadas.map(normalizar)))
    .digest("hex");
}

function delegate(client, model) {
  const nome = model.charAt(0).toLowerCase() + model.slice(1);
  if (!client[nome]) throw new Error(`Modelo não encontrado: ${model}`);
  return client[nome];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não encontrada no .env");
  }

  if (!process.env.TURSO_DATABASE_URL ||
      !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("Configuração do Turso incompleta no .env.turso");
  }

  console.log("Lendo dados do Aiven...");

  const dados = {};
  let totalOrigem = 0;

  for (const modelo of modelos) {
    const rows = await delegate(origem, modelo).findMany();
    dados[modelo] = rows;
    totalOrigem += rows.length;
    console.log(`AIVEN ${modelo}: ${rows.length}`);
  }

  console.log(`TOTAL AIVEN: ${totalOrigem}`);

  console.log("\nVerificando se o Turso está vazio...");

  for (const modelo of modelos) {
    const quantidade = await delegate(destino, modelo).count();

    if (quantidade !== 0) {
      throw new Error(
        `Turso não está vazio: ${modelo} contém ${quantidade} registros. Importação cancelada.`
      );
    }
  }

  console.log("Turso vazio nas 18 tabelas.");
  console.log("\nIniciando importação transacional...");

  await destino.$transaction(async (tx) => {
    for (const modelo of modelos) {
      const rows = dados[modelo];
      const tabela = delegate(tx, modelo);

      for (let i = 0; i < rows.length; i += 50) {
        const lote = rows.slice(i, i + 50);
        if (lote.length) {
          await tabela.createMany({ data: lote });
        }
      }

      const importados = await tabela.findMany();

      if (importados.length !== rows.length) {
        throw new Error(
          `Quantidade divergente em ${modelo}: origem ${rows.length}, destino ${importados.length}`
        );
      }

      const hashOrigem = checksum(rows);
      const hashDestino = checksum(importados);

      if (hashOrigem !== hashDestino) {
        throw new Error(`Checksum divergente em ${modelo}.`);
      }

      console.log(`OK ${modelo}: ${importados.length} registros`);
    }
  });

  console.log("\nTransação concluída.");

  let totalDestino = 0;

  for (const modelo of modelos) {
    const quantidade = await delegate(destino, modelo).count();
    totalDestino += quantidade;
    console.log(`TURSO ${modelo}: ${quantidade}`);
  }

  console.log("\n==============================");
  console.log(`TOTAL AIVEN: ${totalOrigem}`);
  console.log(`TOTAL TURSO: ${totalDestino}`);
  console.log(
    totalOrigem === totalDestino
      ? "IMPORTAÇÃO CONCLUÍDA E VALIDADA."
      : "ATENÇÃO: TOTAIS DIFERENTES."
  );
  console.log("==============================");

  if (totalOrigem !== totalDestino) {
    throw new Error("Total final divergente.");
  }
}

main()
  .catch((erro) => {
    console.error("\nFALHA NA MIGRAÇÃO:", erro.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      origem.$disconnect(),
      destino.$disconnect()
    ]);
  });
