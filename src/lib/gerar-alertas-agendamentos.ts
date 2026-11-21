
import { prisma } from "@/lib/prisma";

export async function gerarAlertasDeAgendamento(): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const agora = new Date();

      const agendamentos = await tx.agendamentoCarregamento.findMany({
        where: {
          status: "AGENDADO",
          dataHora: { lte: agora },
          alertaGeradoEm: null,
        },
        orderBy: { dataHora: "desc" },
        take: 200,
        select: {
          id: true,
          origem: true,
          destino: true,
          caminhao: {
            select: { placa: true },
          },
        },
      });

      if (agendamentos.length === 0) return 0;

      const ids = agendamentos.map((item) => item.id);
      const reservados: typeof agendamentos = [];

      for (const item of agendamentos) {
        const reserva = await tx.agendamentoCarregamento.updateMany({
          where: {
            id: item.id,
            status: "AGENDADO",
            dataHora: { lte: agora },
            alertaGeradoEm: null,
          },
          data: {
            alertaGeradoEm: agora,
          },
        });

        if (reserva.count === 1) {
          reservados.push(item);
        }
      }

      if (reservados.length === 0) return 0;

      const idsReservados = reservados.map((item) => item.id);

      const [existentes, exclusoes] = await Promise.all([
        tx.alerta.findMany({
          where: {
            tipo: "AGENDAMENTO",
            referencia: { in: idsReservados },
          },
          select: { referencia: true },
        }),
        tx.auditLog.findMany({
          where: {
            action: "ALERTA_EXCLUIDO",
            entity: "Alerta",
            entityId: {
              in: idsReservados.map((id) => `AGENDAMENTO:${id}`),
            },
          },
          select: { entityId: true },
        }),
      ]);

      const jaTemAlerta = new Set(
        existentes.map((item) => item.referencia)
      );

      const jaExcluidos = new Set(
        exclusoes.map((item) => item.entityId)
      );

      const novos = reservados.filter(
        (item) =>
          !jaTemAlerta.has(item.id) &&
          !jaExcluidos.has(`AGENDAMENTO:${item.id}`)
      );

      if (novos.length === 0) return 0;

      const resultado = await tx.alerta.createMany({
        data: novos.map((item) => ({
          tipo: "AGENDAMENTO",
          titulo: "Agendamento chegou ao horário",
          mensagem: `O agendamento do caminhão ${item.caminhao.placa} chegou ao horário programado: ${item.origem} - ${item.destino}.`,
          severidade: "WARNING" as const,
          referencia: item.id,
        })),
      });

      return resultado.count;
    },
    {
      maxWait: 10000,
      timeout: 30000,
    }
  );
}
