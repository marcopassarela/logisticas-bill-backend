import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")?.trim() || "";

    if (!token) {
      return NextResponse.json({ error: "Token inválido." }, { status: 400 });
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: {
        user: {
          select: { username: true, name: true, isActive: true },
        },
      },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      !record.user.isActive
    ) {
      return NextResponse.json(
        { error: "Este link expirou ou já foi utilizado. Solicite uma nova redefinição." },
        { status: 410 },
      );
    }

    return NextResponse.json({
      ok: true,
      username: record.user.username,
      name: record.user.name,
    });
  } catch (error) {
    console.error("reset-password GET:", error);
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword =
      typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!token) {
      return NextResponse.json({ error: "Token inválido." }, { status: 400 });
    }

    if (password.length < 4) {
      return NextResponse.json(
        { error: "A senha deve ter no mínimo 4 caracteres." },
        { status: 400 },
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: "A senha e a confirmação não coincidem." },
        { status: 400 },
      );
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
      },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: "Este link expirou ou já foi utilizado. Solicite uma nova redefinição." },
        { status: 410 },
      );
    }

    const passwordHash = await hashPassword(password);

    try {
      await prisma.$transaction(async (tx) => {
        const now = new Date();

        const consumed = await tx.passwordResetToken.updateMany({
          where: {
            id: record.id,
            userId: record.userId,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });

        if (consumed.count !== 1) {
          throw new Error("RESET_TOKEN_INVALID");
        }

        const updatedUser = await tx.user.updateMany({
          where: {
            id: record.userId,
            isActive: true,
          },
          data: { passwordHash },
        });

        if (updatedUser.count !== 1) {
          throw new Error("RESET_TOKEN_INVALID");
        }

        await tx.session.deleteMany({
          where: { userId: record.userId },
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "RESET_TOKEN_INVALID") {
        return NextResponse.json(
          { error: "Este link expirou, já foi utilizado ou a conta está inativa. Solicite uma nova redefinição." },
          { status: 410 },
        );
      }

      throw error;
    }

    return NextResponse.json({
      ok: true,
      message: "Senha redefinida com sucesso. Faça login com a nova senha.",
    });
  } catch (error) {
    console.error("reset-password POST:", error);
    return NextResponse.json(
      { error: "Erro interno. Tente novamente." },
      { status: 500 },
    );
  }
}