import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

/** GET ?token= — valida o token e devolve o username fixo */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() || "";
  if (!token) {
    return NextResponse.json({ error: "Token inválido." }, { status: 400 });
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, username: true, name: true, isActive: true } } },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now() || !record.user.isActive) {
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
}

/** POST { token, password, confirmPassword } */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!token) {
      return NextResponse.json({ error: "Token inválido." }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "A senha deve ter no mínimo 4 caracteres." }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "A senha e a confirmação não coincidem." }, { status: 400 });
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: { select: { id: true, isActive: true } } },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now() || !record.user.isActive) {
      return NextResponse.json(
        { error: "Este link expirou ou já foi utilizado. Solicite uma nova redefinição." },
        { status: 410 },
      );
    }

    const passwordHash = await hashPassword(password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Encerra sessões ativas do usuário
      prisma.session.deleteMany({ where: { userId: record.userId } }),
    ]);

    return NextResponse.json({ ok: true, message: "Senha redefinida com sucesso. Faça login com a nova senha." });
  } catch (error) {
    console.error("reset-password:", error);
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
  }
}
