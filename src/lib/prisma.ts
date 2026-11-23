import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

  if (!url || !authToken) {
    if (isProductionBuild) {
      return new PrismaClient({
        adapter: new PrismaLibSQL({
          url: "file:./build-placeholder.db",
        }),
        log: ["error"],
      });
    }
    throw new Error("TURSO_DATABASE_URL e TURSO_AUTH_TOKEN devem estar configurados.");
  }

  return new PrismaClient({
    adapter: new PrismaLibSQL({ url, authToken }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Reutiliza o cliente quando a instância é reaproveitada, inclusive em produção.
globalForPrisma.prisma = prisma;
