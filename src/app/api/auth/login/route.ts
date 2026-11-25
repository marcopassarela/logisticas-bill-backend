import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import { checkActivationRateLimit } from "@/lib/device-security";
import {
  consumeChallenge,
  normalizePublicKey,
} from "@/lib/device-security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const limit = await checkActivationRateLimit(req, "LOGIN");

    if (limit.blocked) {
      return NextResponse.json(
        {
          error: "Muitas tentativas de login. Aguarde antes de tentar novamente.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const { username, password, publicKey, challenge, signature } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 },
      );
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      return NextResponse.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 },
      );
    }

    let deviceAuthorizationId: string | undefined;

    if (user.role !== "ADMIN") {
      if (!publicKey || !challenge || !signature) {
        return NextResponse.json(
          {
            error: "Este dispositivo ainda não foi autorizado. Ative o dispositivo para continuar.",
            code: "DEVICE_NOT_AUTHORIZED",
          },
          { status: 403 },
        );
      }

      let normalizedKey: string;

      try {
        normalizedKey = normalizePublicKey(publicKey);
      } catch {
        return NextResponse.json(
          { error: "Chave criptográfica inválida." },
          { status: 400 },
        );
      }

      try {
        await consumeChallenge({
          publicKey: normalizedKey,
          challenge,
          signature,
          purpose: "LOGIN",
        });
      } catch {
        return NextResponse.json(
          { error: "A validação do dispositivo falhou ou expirou. Tente novamente." },
          { status: 401 },
        );
      }

      const device = await prisma.deviceAuthorization.findFirst({
        where: {
          userId: user.id,
          publicKey: normalizedKey,
          revokedAt: null,
        },
        select: { id: true },
      });

      if (!device) {
        return NextResponse.json(
          {
            error: "Este dispositivo não está autorizado para esta conta. Solicite uma chave ao administrador.",
            code: "DEVICE_NOT_AUTHORIZED",
          },
          { status: 403 },
        );
      }

      deviceAuthorizationId = device.id;

      await prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    }

    await createSession(
      user.id,
      user.permissions ?? {},
      user.role,
      deviceAuthorizationId,
    );

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DEVICE_NOT_AUTHORIZED") {
      return NextResponse.json(
        { error: "Dispositivo não autorizado.", code: "DEVICE_NOT_AUTHORIZED" },
        { status: 403 },
      );
    }

    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
