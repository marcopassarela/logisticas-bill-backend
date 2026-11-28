import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { publishDataChanged } from "@/lib/realtime";
import { del } from "@vercel/blob";

async function carregarItem(itemId: string) {
  return prisma.carregamentoItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      entregaFotoPath: true,
      carregamento: {
        select: { id: true, motoristaId: true, data: true },
      },
    },
  });
}

function temAcesso(user: { role: string; funcionarioId: string | null }, item: NonNullable<Awaited<ReturnType<typeof carregarItem>>>) {
  if (user.role === "ADMIN" || user.role === "MANAGER") return true;
  return Boolean(
    user.funcionarioId &&
    item.carregamento.motoristaId === user.funcionarioId &&
    item.carregamento.data <= new Date()
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  if (!canAccess(user.role, user.permissions, "carregamentos.marcarEntregue")) {
    return NextResponse.json({ error: "Sem permissão para editar a confirmação." }, { status: 403 });
  }

  const { itemId } = await params;
  const item = await carregarItem(itemId);

  if (!item) {
    return NextResponse.json({ error: "Entrega não encontrada." }, { status: 404 });
  }

  if (!temAcesso(user, item)) {
    return NextResponse.json({ error: "Você não tem acesso a esta entrega." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.observacao !== "string" || body.observacao.trim().length > 2000) {
    return NextResponse.json({ error: "Informe uma observação válida, com até 2.000 caracteres." }, { status: 400 });
  }

  await prisma.carregamentoItem.update({
    where: { id: itemId },
    data: { entregaObservacao: body.observacao.trim() || null },
  });

  after(() => publishDataChanged("carregamentos"));

  return NextResponse.json({ ok: true, itemId });
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
    return NextResponse.json({ error: "Sem permissão para excluir a confirmação." }, { status: 403 });
  }

  const { itemId } = await params;
  const item = await carregarItem(itemId);

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

  // Mantém o CarregamentoItem e os dados comerciais do cliente.
  // Remove somente os dados da confirmação da entrega.
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
