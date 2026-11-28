import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  if (!canAccess(user.role, user.permissions, "carregamentos.visualizar")) {
    return NextResponse.json({ error: "Sem permissão para visualizar entregas." }, { status: 403 });
  }

  const isGestor = user.role === "ADMIN" || user.role === "MANAGER";

  const itens = await prisma.carregamentoItem.findMany({
    where: isGestor
      ? {}
      : {
          carregamento: {
            is: {
              motoristaId: user.funcionarioId || "__sem_motorista__",
              data: { lte: new Date() },
            },
          },
        },
    select: {
      id: true,
      carregamentoId: true,
      quantidade: true,
      peso: true,
      statusItem: true,
      entregue: true,
      entregaFotoPath: true,
      entregaFotoNome: true,
      entregaFotoCriadaEm: true,
      entregueEm: true,
      entregaObservacao: true,
      entregaConfirmadaPorId: true,
      entregaConfirmadaPorNome: true,
      descricaoLivre: true,
      ordemServico: true,
      clienteNome: true,
      clienteTelefone: true,
      clienteCidade: true,
      clienteBairro: true,
      mapaUrl: true,
      mapaUrl2: true,
      adicionais: {
        orderBy: [{ ordem: "asc" }, { id: "asc" }],
        select: { id: true, descricao: true, ordem: true },
      },
      carregamento: {
        select: {
          id: true,
          data: true,
          origem: true,
          destino: true,
          status: true,
          motorista: { select: { id: true, nome: true } },
          ajudante: { select: { id: true, nome: true } },
          caminhao: { select: { placa: true } },
        },
      },
    },
    orderBy: [
      { entregueEm: "desc" },
      { carregamento: { data: "desc" } },
      { ordem: "asc" },
    ],
  });

  return NextResponse.json(itens);
}
