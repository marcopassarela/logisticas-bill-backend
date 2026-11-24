import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

const RETENTION_DAYS = 7;

/**
 * Cron diário: remove PDFs do Vercel Blob com mais de 7 dias
 * e limpa os campos no banco (notaFiscalPath / notaFiscalDisponivel).
 *
 * Protegido por CRON_SECRET (header Authorization: Bearer <secret>
 * ou query ?secret=).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  const q = req.nextUrl.searchParams.get("secret") || "";
  const ok =
    (!!secret && auth === `Bearer ${secret}`) ||
    (!!secret && q === secret) ||
    // Vercel Cron envia este header automaticamente em planos com Cron
    req.headers.get("x-vercel-cron") === "1";

  if (!ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    const itens = await prisma.carregamentoItem.findMany({
      where: {
        notaFiscalPath: { not: null },
        // usa updatedAt do item como proxy de idade do PDF
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        notaFiscalPath: true,
        carregamentoId: true,
      },
      take: 200,
    });

    let deletedBlobs = 0;
    let clearedRows = 0;
    const errors: string[] = [];

    for (const item of itens) {
      if (!item.notaFiscalPath) continue;

      try {
        await del(item.notaFiscalPath);
        deletedBlobs += 1;
      } catch (err) {
        // Blob pode já ter sido removido; continua limpando o banco
        errors.push(`blob ${item.id}: ${err instanceof Error ? err.message : "erro"}`);
      }

      await prisma.carregamentoItem.update({
        where: { id: item.id },
        data: {
          notaFiscalPath: null,
          notaFiscalDisponivel: false,
          notaFiscalNome: null,
          notaFiscalData: null,
        },
      });
      clearedRows += 1;
    }

    return NextResponse.json({
      ok: true,
      cutoff: cutoff.toISOString(),
      scanned: itens.length,
      deletedBlobs,
      clearedRows,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("cleanup-pdfs:", error);
    return NextResponse.json({ error: "Falha na limpeza de PDFs." }, { status: 500 });
  }
}
