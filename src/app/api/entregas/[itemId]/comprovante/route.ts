import { after, NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { publishDataChanged } from "@/lib/realtime";
import { put, del } from "@vercel/blob";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_WEBP_SIZE = 350 * 1024;

async function converterParaWebP(bytes: Buffer): Promise<Buffer> {
  const resolucoes = [1600, 1400, 1200, 1000, 900, 800, 700, 600, 500, 400];
  const qualidades = [80, 72, 64, 56, 48, 40, 32, 24];

  for (const largura of resolucoes) {
    for (const qualidade of qualidades) {
      const convertido = await sharp(bytes)
        .rotate()
        .resize({
          width: largura,
          height: largura,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: qualidade, effort: 4 })
        .toBuffer();

      if (convertido.length <= MAX_WEBP_SIZE) {
        return convertido;
      }
    }
  }

  throw new Error("Não foi possível reduzir a fotografia para até 350 KB.");
}

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
    return NextResponse.json({ error: "A fotografia original deve ter até 8 MB." }, { status: 400 });
  }

  if (file.type !== "image/jpeg") {
    return NextResponse.json({ error: "A câmera deve enviar a fotografia em JPEG." }, { status: 400 });
  }

  if (observacao.length > 2000) {
    return NextResponse.json({ error: "A observação deve ter no máximo 2.000 caracteres." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const jpegValido =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  if (!jpegValido) {
    return NextResponse.json({ error: "O conteúdo recebido não é uma fotografia JPEG válida." }, { status: 400 });
  }

  let webp: Buffer;

  try {
    webp = await converterParaWebP(bytes);
  } catch (error) {
    console.error("Falha ao converter comprovante para WebP:", error);
    return NextResponse.json({ error: "Não foi possível converter a fotografia. Tente novamente." }, { status: 400 });
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

  await put(pathname, webp, {
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