import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/mail";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

/**
 * POST { username, email }
 * Sempre responde de forma genérica para não vazar existência de conta.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!username || !email) {
      return NextResponse.json(
        { error: "Informe o nome de usuário e o e-mail cadastrado." },
        { status: 400 },
      );
    }

    const users = await prisma.$queryRaw<
      Array<{ id: string; name: string; username: string; email: string | null }>
    >`
      SELECT id, name, username, email
      FROM "User"
      WHERE LOWER(username) = LOWER(${username})
        AND LOWER(email) = LOWER(${email})
        AND isActive = 1
      LIMIT 1
    `;

    const user = users[0] ?? null;

    // Resposta genérica (não revela se o usuário existe)
    const generic = {
      ok: true,
      message:
        "Se os dados estiverem corretos, você receberá um e-mail com o link de redefinição em instantes.",
    };

    if (!user || !user.email) {
      return NextResponse.json(generic);
    }

    // Invalida tokens anteriores não usados
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await prisma.passwordResetToken.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        token,
        expiresAt,
      },
    });

    const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        username: user.username,
        resetUrl,
      });
    } catch (err) {
      console.error("Falha ao enviar e-mail de reset:", err);
      return NextResponse.json(
        { error: "Não foi possível enviar o e-mail. Tente novamente em alguns minutos." },
        { status: 502 },
      );
    }

    return NextResponse.json(generic);
  } catch (error) {
    console.error("forgot-password:", error);
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
  }
}
