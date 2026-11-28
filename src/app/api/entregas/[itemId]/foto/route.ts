import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { publishDataChanged } from "@/lib/realtime";
import { get, del } from "@vercel/blob";

async function obterItem(itemId: string) {
  return prisma.carregamentoItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      entregaFotoPath: true,
      entregaFotoNome: true,
      carregamento: {
        select: { id: true, motoristaId: true, data: true },
      },
    },
  });
}

function temAcesso(user: { role: string; funcionarioId: string | null }, item: NonNullable<Awaited<ReturnType<typeof obterItem>>>) {
  if (user.role === "ADMIN" || user.role === "MANAGER") return true;
  return Boolean(
    user.funcionarioId &&
    item.carregamento.motoristaId === user.funcionarioId &&
    item.carregamento.data <= new Date()
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  if (!canAccess(user.role, user.permissions, "carregamentos.visualizar")) {
    return NextResponse.json({ error: "Sem permissão para visualizar comprovantes." }, { status: 403 });
  }

  const { itemId } = await params;
  const item = await obterItem(itemId);

  if (!item || !item.entregaFotoPath) {
    return NextResponse.json({ error: "Fotografia do comprovante não encontrada." }, { status: 404 });
  }

  if (!temAcesso(user, item)) {
    return NextResponse.json({ error: "Você não tem acesso a este comprovante." }, { status: 403 });
  }

  const prefix = `comprovantes-entrega/${item.carregamento.id}/${itemId}/`;

  if (!item.entregaFotoPath.startsWith(prefix)) {
    return NextResponse.json({ error: "Comprovante não encontrado." }, { status: 404 });
  }

  try {
    const blob = await get(item.entregaFotoPath, { access: "private" });

    if (
      !blob ||
      blob.statusCode !== 200 ||
      blob.blob.contentType !== "image/webp" ||
      blob.blob.size <= 0 ||
      blob.blob.size > 350 * 1024
    ) {
      return NextResponse.json({ error: "Comprovante não encontrado." }, { status: 404 });
    }

    return new NextResponse(blob.stream, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(blob.blob.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${itemId}.webp"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a fotografia." }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  if (!canAccess(user.role, user.permissions, "carregamentos.marcarEntregue")) {
    return NextResponse.json({ error: "Sem permissão para excluir comprovantes." }, { status: 403 });
  }

  const { itemId } = await params;
  const item = await obterItem(itemId);

  if (!item) {
    return NextResponse.json({ error: "Entrega não encontrada." }, { status: 404 });
  }

  if (!temAcesso(user, item)) {
    return NextResponse.json({ error: "Você não tem acesso a esta entrega." }, { status: 403 });
  }

  if (item.entregaFotoPath) {
    const prefix = `comprovantes-entrega/${item.carregamento.id}/${itemId}/`;

    if (!item.entregaFotoPath.startsWith(prefix)) {
      return NextResponse.json({ error: "Caminho do comprovante inválido." }, { status: 400 });
    }

    await del(item.entregaFotoPath);
  }

  await prisma.carregamentoItem.update({
    where: { id: itemId },
    data: {
      entregue: false,
      entregaFotoPath: null,
      entregaFotoNome: null,
      entregaFotoCriadaEm: null,
      entregueEm: null,
      entregaObservacao: null,
      entregaConfirmadaPorId: null,
      entregaConfirmadaPorNome: null,
    },
  });

  after(() => publishDataChanged("carregamentos"));

  return NextResponse.json({ ok: true, itemId, entregue: false });
}
