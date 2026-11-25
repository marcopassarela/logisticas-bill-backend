import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

async function isAdmin() {
  const user = await getCurrentUser();
  return user?.role === "ADMIN" ? user : null;
}

function generateCode() {
  const groups = randomBytes(20).toString("hex").toUpperCase().match(/.{4}/g);
  return `LB-${groups!.join("-")}`;
}

function hashCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Somente administradores." }, { status: 403 });
  }

  try {
    const keys = await prisma.activationKey.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        targetUser: {
          select: { id: true, username: true, name: true },
        },
      },
    });

    const now = new Date();

    return NextResponse.json(keys.map((key) => ({
      id: key.id,
      targetUser: key.targetUser,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      usedAt: key.usedAt,
      closedAt: key.closedAt,
      closedReason: key.closedReason,
      status: key.closedReason === "REVOKED"
        ? "REVOKED"
        : key.closedAt
          ? "EXPIRED"
          : key.usedAt
            ? "USED"
            : key.expiresAt && key.expiresAt <= now
              ? "EXPIRED"
              : "PENDING",
    })));
  } catch (error) {
    console.error("activation-keys GET:", error);
    return NextResponse.json({ error: "Não foi possível carregar as chaves." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Somente administradores." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const targetUserId =
      typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";

    if (!targetUserId) {
      return NextResponse.json(
        { error: "Selecione o usuário que receberá a chave." },
        { status: 400 },
      );
    }

    const neverExpires = body.neverExpires === true;
    let expiresAt: Date | null = null;

    if (!neverExpires) {
      expiresAt = body.expiresAt
        ? new Date(body.expiresAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
        return NextResponse.json(
          { error: "A data de expiração deve ser válida e futura." },
          { status: 400 },
        );
      }
    }

    const code = generateCode();
    const codeHash = hashCode(code);
    const now = new Date();

    const key = await prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findFirst({
        where: {
          id: targetUserId,
          isActive: true,
          role: { in: ["USER", "MANAGER"] },
        },
        select: { id: true, username: true, name: true },
      });

      if (!targetUser) {
        throw new Error("ACTIVATION_TARGET_INVALID");
      }

      await tx.activationKey.updateMany({
        where: {
          targetUserId,
          usedAt: null,
          closedAt: null,
          expiresAt: { lt: now },
        },
        data: {
          closedAt: now,
          closedReason: "EXPIRED",
        },
      });

      const pending = await tx.activationKey.findFirst({
        where: {
          targetUserId,
          usedAt: null,
          closedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        select: { id: true },
      });

      if (pending) {
        throw new Error("ACTIVATION_KEY_PENDING");
      }

      const created = await tx.activationKey.create({
        data: {
          codeHash,
          targetUserId,
          expiresAt,
          createdByUserId: admin.id,
        },
        include: {
          targetUser: {
            select: { id: true, username: true, name: true },
          },
        },
      });

      return created;
    });

    return NextResponse.json({
      ok: true,
      code,
      key: {
        id: key.id,
        targetUser: key.targetUser,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        status: "PENDING",
      },
      message: "Chave criada. Copie o código, ele será exibido somente agora.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "ACTIVATION_TARGET_INVALID") {
      return NextResponse.json(
        { error: "O usuário selecionado não existe ou está inativo." },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.message === "ACTIVATION_KEY_PENDING") {
      return NextResponse.json(
        { error: "Este usuário já possui uma chave de ativação pendente." },
        { status: 409 },
      );
    }

    console.error("activation-keys POST:", error);
    return NextResponse.json(
      { error: "Não foi possível criar a chave de ativação." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Somente administradores." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json({ error: "ID da chave obrigatório." }, { status: 400 });
    }

    const result = await prisma.activationKey.deleteMany({
      where: { id },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: "Chave não encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, message: "Registro da chave removido." });
  } catch (error) {
    console.error("activation-keys DELETE:", error);
    return NextResponse.json(
      { error: "Não foi possível revogar a chave." },
      { status: 500 },
    );
  }
}
