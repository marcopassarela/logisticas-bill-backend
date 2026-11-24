import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const databaseUrl = process.env.TURSO_DATABASE_URL?.trim() || "";
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || "";
  const configuration = {
    urlConfigured: Boolean(databaseUrl),
    tokenConfigured: Boolean(authToken),
    scheme: databaseUrl.split(":", 1)[0] || null,
  };

  if (!databaseUrl || !authToken) {
    console.error("[health/database] configuração Turso incompleta", configuration);
    return NextResponse.json(
      { ok: false, error: "TURSO_CONFIG_MISSING", configuration },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  try {
    // Usa o cliente libSQL diretamente neste endpoint para que o diagnóstico
    // continue funcionando mesmo se o Prisma Client/adapter falhar ao carregar.
    const client = createClient({
      url: databaseUrl,
      authToken,
    });

    try {
      await client.execute("SELECT 1");
    } finally {
      client.close();
    }

    return NextResponse.json(
      { ok: true },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[health/database] falha na conexão Turso", {
      ...configuration,
      error: message.slice(0, 500),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "TURSO_CONNECTION_FAILED",
        configuration,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }
}
