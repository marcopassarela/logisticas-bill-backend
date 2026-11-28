import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { publishDataChanged } from "@/lib/realtime";
import { put, del } from "@vercel/blob";

const MAX_IMAGE_SIZE = 350 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  if (!canAccess(user.role, user.permissions, "carregamentos.marcarEntregue")) {
    return NextResponse.json({ error: "Sem permissão para confirmar entregas." }, { status: 403 });
  }

  const { itemId } = await params;
  const formData = await req.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json({ error: "Não foi possível ler o comprovante." }, { status: 400 });
  }

  const file = formData.get("file");
  const observacaoRaw = formData.get("observacao");
  const observacao = typeof observacaoRaw === "string" ? observacaoRaw.trim() : "";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A fotografia é obrigatória para concluir a entrega." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "A fotografia deve ter até 350 KB." }, { status: 400 });
  }

  if (file.type !== "image/webp") {
    return NextResponse.json({ error: "O comprovante deve estar no formato WebP." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const assinaturaValida =
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";

  if (!assinaturaValida) {
    return NextResponse.json({ error: "O conteúdo enviado não é uma imagem WebP válida." }, { status: 400 });
  }

  if (observacao.length > 2000) {
    return NextResponse.json({ error: "A observação deve ter no máximo 2.000 caracteres." }, { status: 400 });
  }

  const item = await prisma.carregamentoItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      entregue: true,
      entregaFotoPath: true,
      carregamento: {
        select: { id: true, motoristaId: true, data: true },
      },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Entrega não encontrada." }, { status: 404 });
  }

  const isGestor = user.role === "ADMIN" || user.role === "MANAGER";

  if (!isGestor && (
    !user.funcionarioId ||
    item.carregamento.motoristaId !== user.funcionarioId ||
    item.carregamento.data > new Date()
  )) {
    return NextResponse.json({ error: "Você não tem acesso a esta entrega." }, { status: 403 });
  }

  if (item.entregue || item.entregaFotoPath) {
    return NextResponse.json({ error: "Esta entrega já possui uma confirmação. Consulte ou remova a confirmação existente antes de continuar." }, { status: 409 });
  }

  const nome = `comprovante-${itemId}.webp`;
  const pathname = `comprovantes-entrega/${item.carregamento.id}/${itemId}/${crypto.randomUUID()}.webp`;

  await put(pathname, Buffer.from(bytes), {
    access: "private",
    contentType: "image/webp",
    addRandomSuffix: false,
  });

  try {
    const atualizado = await prisma.carregamentoItem.updateMany({
      where: {
        id: itemId,
        entregue: false,
        entregaFotoPath: null,
      },
      data: {
        entregue: true,
        entregaFotoPath: pathname,
        entregaFotoNome: nome,
        entregaFotoCriadaEm: new Date(),
        entregueEm: new Date(),
        entregaObservacao: observacao || null,
        entregaConfirmadaPorId: user.id,
        entregaConfirmadaPorNome: user.name,
      },
    });

    if (atualizado.count === 0) {
      await del(pathname);
      return NextResponse.json({ error: "A entrega foi alterada por outra operação. Atualize a tela e tente novamente." }, { status: 409 });
    }
  } catch (error) {
    await del(pathname).catch((blobError) => {
      console.error("Falha ao remover comprovante após erro no banco:", blobError);
    });
    throw error;
  }

  after(() => publishDataChanged("carregamentos"));

  return NextResponse.json({
    ok: true,
    itemId,
    entregue: true,
    entregaFotoNome: nome,
    entregueEm: new Date().toISOString(),
  });
}
