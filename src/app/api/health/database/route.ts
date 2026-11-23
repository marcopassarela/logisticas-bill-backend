import { NextResponse } from "next/server";
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
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;

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
      { ok: false, error: "TURSO_CONNECTION_FAILED", configuration },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }
}
