import { PrismaClient } from "@prisma/client";
import { PrismaClient as TursoPrismaClient } from "../generated/turso";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  tursoHttp?: {
    active: number;
    peak: number;
    total: number;
  };
};

function createPrismaClient(): PrismaClient {
  const isProductionBuild =
    process.env.NEXT_PHASE === "phase-production-build";

  if (process.env.DATABASE_PROVIDER?.toLowerCase() === "turso") {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url || !authToken) {
      throw new Error(
        "TURSO_DATABASE_URL ou TURSO_AUTH_TOKEN nao configurada."
      );
    }

    const stats = globalForPrisma.tursoHttp ??= {
      active: 0,
      peak: 0,
      total: 0,
    };
    
    const monitoredFetch: typeof fetch = async (input, init) => {
      stats.active++;
      stats.total++;
      stats.peak = Math.max(stats.peak, stats.active);
    
      console.info(
        `[TURSO_HTTP] início | simultâneas=${stats.active} | pico=${stats.peak} | total=${stats.total}`
      );
    
      try {
        return await fetch(input, init);
      } finally {
        stats.active--;
      
        console.info(
          `[TURSO_HTTP] fim | simultâneas=${stats.active} | pico=${stats.peak}`
        );
      }
    };
    
    console.info("[TURSO_HTTP] Monitor ativado");
    
    const adapter = new PrismaLibSQL({
      url,
      authToken,
      fetch: monitoredFetch,
    });
    const client = new TursoPrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

    return client as unknown as PrismaClient;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const resolvedDatabaseUrl =
    databaseUrl ||
    (isProductionBuild
      ? "postgresql://build:build@127.0.0.1:5432/build?sslmode=disable"
      : undefined);

  if (!resolvedDatabaseUrl) {
    throw new Error("DATABASE_URL nao esta configurada.");
  }

  let url: URL;
  try {
    url = new URL(resolvedDatabaseUrl);
  } catch {
    if (!isProductionBuild) {
      throw new Error("DATABASE_URL esta configurada com formato invalido.");
    }
    url = new URL(
      "postgresql://build:build@127.0.0.1:5432/build?sslmode=disable"
    );
  }

  url.searchParams.set(
    "connection_limit",
    process.env.PRISMA_CONNECTION_LIMIT || "1"
  );
  url.searchParams.set(
    "pool_timeout",
    process.env.PRISMA_POOL_TIMEOUT || "10"
  );

  return new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;