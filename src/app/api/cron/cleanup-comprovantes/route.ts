import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { publishDataChanged } from "@/lib/realtime";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) return false;

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  const recebido = Buffer.from(token);
  const esperado = Buffer.from(secret);

  return (
    recebido.length === esperado.length &&
    timingSafeEqual(recebido, esperado)
  );
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado." },
      { status: 503 }
    );
  }

  if (!autorizado(req)) {
    return NextResponse.json(
      { error: "Não autorizado." },
      { status: 401 }
    );
  }

  const limite = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const expirados = await prisma.carregamentoItem.findMany({
    where: {
      entregaFotoPath: { not: null },
      entregaFotoCriadaEm: { lte: limite },
    },
    select: {
      id: true,
      carregamentoId: true,
      entregaFotoPath: true,
    },
  });

  let removidos = 0;
  let ignorados = 0;
  const erros: string[] = [];

  for (const item of expirados) {
    const path = item.entregaFotoPath;

    if (!path) {
      ignorados++;
      continue;
    }

    const prefixo = `comprovantes-entrega/${item.carregamentoId}/${item.id}/`;

    if (!path.startsWith(prefixo)) {
      ignorados++;
      erros.push(`${item.id}: caminho fora do prefixo permitido`);
      continue;
    }

    try {
      // Remove exclusivamente a fotografia do comprovante.
      await del(path);

      // Preserva a conclusão, data, observação e responsável.
      // Limpa somente os dados da fotografia.
      const resultado = await prisma.carregamentoItem.updateMany({
        where: {
          id: item.id,
          entregaFotoPath: path,
          entregaFotoCriadaEm: { lte: limite },
        },
        data: {
          entregaFotoPath: null,
          entregaFotoNome: null,
          entregaFotoCriadaEm: null,
        },
      });

      if (resultado.count > 0) {
        removidos++;
      } else {
        ignorados++;
      }
    } catch (error) {
      console.error(`Erro ao limpar comprovante ${item.id}:`, error);
      erros.push(item.id);
    }
  }

  if (removidos > 0) {
    await publishDataChanged("carregamentos");
  }

  return NextResponse.json({
    ok: true,
    encontrados: expirados.length,
    fotografiasRemovidas: removidos,
    ignorados,
    erros,
    executadoEm: new Date().toISOString(),
  });
}
