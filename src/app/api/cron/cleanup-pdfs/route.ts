import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Limpeza automática temporariamente suspensa.
 *
 * CarregamentoItem não possui data de envio do PDF.
 * Não excluir arquivos com base na data da carga,
 * pois uma nota pode ser anexada posteriormente.
 *
 * A exclusão será reativada quando houver um registro
 * confiável da data de envio do documento.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  const querySecret = req.nextUrl.searchParams.get("secret") || "";

  const authorized =
    (!!secret && auth === `Bearer ${secret}`) ||
    (!!secret && querySecret === secret) ||
    req.headers.get("x-vercel-cron") === "1";

  if (!authorized) {
    return NextResponse.json(
      { error: "Não autorizado." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    skipped: true,
    message:
      "Limpeza automática suspensa para preservar notas fiscais.",
    deletedBlobs: 0,
    clearedRows: 0,
  });
}