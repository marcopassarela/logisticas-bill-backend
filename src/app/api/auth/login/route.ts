import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import {
  hashDeviceChallenge,
  verifyDeviceSignature,
} from "@/lib/device-crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const parsed = loginSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos." },
        { status: 400 }
      );
    }

    const { username, password, publicKey, challenge, signature } =
      parsed.data;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 }
      );
    }

    const validPassword = await verifyPassword(user.passwordHash, password);

    if (!validPassword) {
      return NextResponse.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 }
      );
    }

    let deviceAuthorizationId: string | undefined;

    if (user.role !== "ADMIN") {
      if (!publicKey || !challenge || !signature) {
        return NextResponse.json(
          { error: "Ative este dispositivo antes de entrar." },
          { status: 403 }
        );
      }

      if (!verifyDeviceSignature(publicKey, challenge, signature)) {
        return NextResponse.json(
          { error: "Comprovação do dispositivo inválida." },
          { status: 401 }
        );
      }

      const device = await prisma.deviceAuthorization.findFirst({
        where: { publicKey, userId: user.id, revokedAt: null },
        select: { id: true },
      });

      if (!device) {
        return NextResponse.json(
          { error: "Dispositivo não autorizado." },
          { status: 403 }
        );
      }

      const now = new Date();

      const consumed = await prisma.$transaction(async (tx) => {
        const result = await tx.deviceChallenge.updateMany({
          where: {
            challengeHash: hashDeviceChallenge(challenge),
            publicKey,
            purpose: "LOGIN",
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });

        if (result.count !== 1) return false;

        const updatedDevice = await tx.deviceAuthorization.updateMany({
          where: {
            id: device.id,
            userId: user.id,
            revokedAt: null,
          },
          data: { lastSeenAt: now },
        });

        return updatedDevice.count === 1;
      });

      if (!consumed) {
        return NextResponse.json(
          {
            error:
              "Desafio expirado, utilizado ou dispositivo revogado. Gere um novo desafio.",
          },
          { status: 401 }
        );
      }

      deviceAuthorizationId = device.id;
    }

    await createSession(
      user.id,
      user.permissions ?? {},
      user.role,
      deviceAuthorizationId
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
    if (
      error instanceof Error &&
      error.message === "DEVICE_NOT_AUTHORIZED"
    ) {
      return NextResponse.json(
        { error: "Dispositivo não autorizado." },
        { status: 403 }
      );
    }

    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 }
    );
  }
}
