import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const createSchema = z.object({
  targetType: z.enum(["USER", "VISITOR"]),
  targetUserId: z.string().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const revokeSchema = z.object({
  keyId: z.string().min(1),
});

function generateActivationCode() {
  const random = randomBytes(20).toString("hex").toUpperCase();
  const groups = random.match(/.{4}/g) ?? [];
  return `LB-${groups.join("-")}`;
}

function hashActivationCode(code: string) {
  return createHash("sha256")
    .update(code.trim().toUpperCase())
    .digest("hex");
}

export async function GET() {
  try {
    const admin = await getCurrentUser();

    if (!admin || admin.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Acesso permitido somente ao administrador." },
        { status: 403 }
      );
    }

    const keys = await prisma.activationKey.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        targetUser: {
          select: {
            id: true,
            name: true,
            username: true,
            cargoUsuario: true,
          },
        },
        visitorAccess: {
          select: {
            id: true,
            name: true,
            expiresAt: true,
            revokedAt: true,
          },
        },
      },
    });

    const now = new Date();

    return NextResponse.json({
      keys: keys.map((key) => ({
        id: key.id,
        targetType: key.visitorAccessId ? "VISITOR" : "USER",
        targetUser: key.targetUser,
        visitorAccess: key.visitorAccess,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        usedAt: key.usedAt,
        status: key.visitorAccess?.revokedAt ||
          key.closedReason === "REVOKED"
            ? "REVOKED"
            : key.closedReason === "EXPIRED" ||
              (key.expiresAt && key.expiresAt <= now)
              ? "EXPIRED"
              : key.usedAt
                ? "USED"
                : "PENDING",
      })),
    });
  } catch (error) {
    console.error("Erro ao listar chaves de ativação:", error);

    return NextResponse.json(
      { error: "Não foi possível listar os acessos." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await getCurrentUser();

    if (!admin || admin.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Acesso permitido somente ao administrador." },
        { status: 403 }
      );
    }

    const parsed = createSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos para gerar a chave." },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const expiresAt = data.expiresAt
      ? new Date(data.expiresAt)
      : null;

    if (expiresAt && expiresAt <= new Date()) {
      return NextResponse.json(
        { error: "A validade precisa ser uma data futura." },
        { status: 400 }
      );
    }

    if (data.targetType === "USER" && !data.targetUserId) {
      return NextResponse.json(
        { error: "Selecione um usuário." },
        { status: 400 }
      );
    }

    if (data.targetType === "VISITOR" && data.targetUserId) {
      return NextResponse.json(
        { error: "Visitantes não podem ser vinculados a usuários." },
        { status: 400 }
      );
    }

    const code = generateActivationCode();
    const codeHash = hashActivationCode(code);

    const result = await prisma.$transaction(async (tx) => {
      let visitorAccessId: string | null = null;

      if (data.targetType === "USER") {
        const user = await tx.user.findUnique({
          where: { id: data.targetUserId! },
          select: { id: true, isActive: true },
        });

        if (!user || !user.isActive) {
          return { ok: false as const, reason: "USER_INACTIVE" as const };
        }

        const now = new Date();

        await tx.activationKey.updateMany({
          where: {
            targetUserId: data.targetUserId!,
            usedAt: null,
            closedAt: null,
            expiresAt: { lte: now },
          },
          data: {
            closedAt: now,
            closedReason: "EXPIRED",
          },
        });

        const pendingKey = await tx.activationKey.findFirst({
          where: {
            targetUserId: data.targetUserId!,
            usedAt: null,
            closedAt: null,
          },
          select: { id: true },
        });

        if (pendingKey) {
          return { ok: false as const, reason: "PENDING_KEY" as const };
        }
      } else {
        const visitor = await tx.visitorAccess.create({
          data: {
            name: "Visitante",
            permissions: {
              dashboard: true,
              "dashboard.visualizar": true,
            },
            expiresAt,
          },
          select: { id: true },
        });

        visitorAccessId = visitor.id;
      }

      const key = await tx.activationKey.create({
        data: {
          codeHash,
          targetUserId:
            data.targetType === "USER" ? data.targetUserId : null,
          visitorAccessId,
          expiresAt,
          createdByUserId: admin.id,
        },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          targetUserId: true,
          visitorAccessId: true,
        },
      });

      return { ok: true as const, key };
    });

    if (!result.ok) {
      if (result.reason === "PENDING_KEY") {
        return NextResponse.json(
          { error: "Este usuário já possui uma chave válida aguardando utilização." },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Usuário não encontrado ou inativo." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        key: result.key,
        code,
        message:
          "Chave criada. Copie o código, pois ele não poderá ser consultado novamente.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro ao gerar chave de ativação:", error);

    return NextResponse.json(
      { error: "Não foi possível gerar a chave de ativação." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await getCurrentUser();

    if (!admin || admin.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Acesso permitido somente ao administrador." },
        { status: 403 }
      );
    }

    const parsed = revokeSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Identificador da chave inválido." },
        { status: 400 }
      );
    }

    const { keyId } = parsed.data;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.activationKey.findUnique({
        where: { id: keyId },
        select: {
          id: true,
          closedReason: true,
          visitorAccess: {
            select: { revokedAt: true },
          },
        },
      });

      if (!existing) {
        return { ok: false as const, reason: "NOT_FOUND" as const };
      }

      if (
        existing.closedReason === "REVOKED" ||
        existing.visitorAccess?.revokedAt
      ) {
        return { ok: true as const };
      }


      const claimed = await tx.activationKey.updateMany({
        where: {
          id: keyId,
          OR: [
            { closedReason: "EXPIRED" },
            { closedAt: null },
          ],
        },
        data: {
          closedAt: now,
          closedReason: "REVOKED",
        },
      });

      if (claimed.count !== 1) {
        const current = await tx.activationKey.findUnique({
          where: { id: keyId },
          select: {
            closedReason: true,
            usedAt: true,
            expiresAt: true,
            visitorAccess: {
              select: { revokedAt: true },
            },
          },
        });

        if (!current) {
          return { ok: false as const, reason: "NOT_FOUND" as const };
        }

        if (
          current.closedReason === "REVOKED" ||
          current.visitorAccess?.revokedAt
        ) {
          return { ok: true as const };
        }


        return { ok: false as const, reason: "CONFLICT" as const };
      }

      const key = await tx.activationKey.findUnique({
        where: { id: keyId },
        select: {
          targetUserId: true,
          visitorAccessId: true,
          deviceAuthorizationId: true,
        },
      });

      if (!key) {
        throw new Error("ACTIVATION_KEY_NOT_FOUND_AFTER_CLAIM");
      }

      if (key.targetUserId && key.deviceAuthorizationId) {
        await tx.deviceAuthorization.updateMany({
          where: {
            id: key.deviceAuthorizationId,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }

      if (key.visitorAccessId) {
        await tx.visitorAccess.updateMany({
          where: {
            id: key.visitorAccessId,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });

        await tx.deviceAuthorization.updateMany({
          where: {
            visitorAccessId: key.visitorAccessId,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }

      return { ok: true as const };
    });

    if (!result.ok) {
      if (result.reason === "CONFLICT") {
        return NextResponse.json(
          { error: "A chave foi alterada simultaneamente. Atualize a lista e tente novamente." },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Chave não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Acesso revogado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao revogar acesso:", error);

    return NextResponse.json(
      { error: "Não foi possível revogar o acesso." },
      { status: 500 }
    );
  }
}
