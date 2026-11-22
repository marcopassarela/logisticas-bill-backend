
const { PrismaClient: PgClient } = require('@prisma/client');
const { PrismaClient: TursoClient } = require('./src/generated/turso');
const { PrismaLibSQL } = require('@prisma/adapter-libsql');

async function main() {
  console.log('\n=== AUDITORIA AIVEN X TURSO ===\n');

  const pgUrl = process.env.DATABASE_URL;
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!pgUrl || !tursoUrl || !tursoToken) {
    throw new Error('Variáveis de conexão não carregadas.');
  }

  const pg = new PgClient({
    datasources: { db: { url: pgUrl } }
  });

  const adapter = new PrismaLibSQL({
    url: tursoUrl,
    authToken: tursoToken
  });

  const turso = new TursoClient({ adapter });

  const quote = name => `"${name.replace(/"/g, '""')}"`;

  try {
    const pgTables = await pg.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name
    `);

    const tursoTables = await turso.$queryRawUnsafe(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
      ORDER BY name
    `);

    const pgCounts = new Map();
    const tursoCounts = new Map();

    for (const table of pgTables) {
      const result = await pg.$queryRawUnsafe(
        `SELECT COUNT(*) AS total FROM ${quote(table.table_name)}`
      );
      pgCounts.set(table.table_name, String(result[0].total));
    }

    for (const table of tursoTables) {
      const result = await turso.$queryRawUnsafe(
        `SELECT COUNT(*) AS total FROM ${quote(table.name)}`
      );
      tursoCounts.set(table.name, String(result[0].total));
    }

    console.log('Tabelas Aiven:', pgCounts.size);
    console.log('Tabelas Turso:', tursoCounts.size);

    console.log('\n=== COMPARAÇÃO ===\n');

    const names = [...new Set([
      ...pgCounts.keys(),
      ...tursoCounts.keys()
    ])].sort();

    for (const name of names) {
      const aiven = pgCounts.get(name);
      const tursoCount = tursoCounts.get(name);

      if (aiven === undefined) {
        console.log(`SOMENTE TURSO: ${name} (${tursoCount})`);
      } else if (tursoCount === undefined) {
        console.log(`AUSENTE NO TURSO: ${name} (Aiven: ${aiven})`);
      } else {
        const status = aiven === tursoCount ? 'IGUAL' : 'DIFERENTE';
        console.log(`${status}: ${name} | Aiven: ${aiven} | Turso: ${tursoCount}`);
      }
    }

    console.log('\nAuditoria concluída. Somente consultas de leitura.');

  } finally {
    await Promise.all([
      pg.$disconnect(),
      turso.$disconnect()
    ]);
  }
}

main().catch(error => {
  console.error('ERRO NA AUDITORIA:', error.message);
  process.exitCode = 1;
});
