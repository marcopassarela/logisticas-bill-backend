import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkActivationRateLimit,
  consumeChallenge,
  normalizePublicKey,
} from "@/lib/device-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limit = await checkActivationRateLimit(request, "ACTIVATE");
    if (limit.blocked) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde antes de tentar novamente.", retryAfter: limit.retryAfter },
        { status: 429 },
      );
    }

    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const publicKey = normalizePublicKey(body.publicKey);
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    const signature = typeof body.signature === "string" ? body.signature : "";

    if (!/^LB-(?:[A-F0-9]{4}-){9}[A-F0-9]{4}$/.test(code)) {
      return NextResponse.json({ error: "Código de ativação inválido." }, { status: 400 });
    }

    if (!challenge || challenge.length > 128 || !signature) {
      return NextResponse.json({ error: "Validação criptográfica incompleta." }, { status: 400 });
    }

    await consumeChallenge({
      publicKey,
      challenge,
      signature,
      purpose: "ACTIVATE",
    });

    const codeHash = createHash("sha256").update(code).digest("hex");
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const key = await tx.activationKey.findUnique({
        where: { codeHash },
      });

      if (
        !key ||
        !key.targetUserId ||
        key.usedAt ||
        key.closedAt ||
        (key.expiresAt && key.expiresAt <= now)
      ) {
        throw new Error("ACTIVATION_CODE_INVALID");
      }

      const user = await tx.user.findFirst({
        where: {
          id: key.targetUserId,
          isActive: true,
          role: { in: ["USER", "MANAGER"] },
        },
        select: { id: true, username: true, name: true },
      });

      if (!user) throw new Error("ACTIVATION_USER_INVALID");

      const existing = await tx.deviceAuthorization.findUnique({
        where: { publicKey },
      });

      let device;

      if (existing) {
        if (existing.userId !== user.id || !existing.revokedAt) {
          throw new Error("DEVICE_ALREADY_BOUND");
        }

        device = await tx.deviceAuthorization.update({
          where: { id: existing.id },
          data: { revokedAt: null, lastSeenAt: now },
        });
      } else {
        device = await tx.deviceAuthorization.create({
          data: {
            userId: user.id,
            publicKey,
            lastSeenAt: now,
          },
        });
      }

      const consumed = await tx.activationKey.updateMany({
        where: {
          id: key.id,
          usedAt: null,
          closedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        data: {
          usedAt: now,
          deviceAuthorizationId: device.id,
        },
      });

      if (consumed.count !== 1) throw new Error("ACTIVATION_CODE_INVALID");

      return { user };
    });

    return NextResponse.json({
      ok: true,
      user: result.user,
      message: "Chave ativada com sucesso!",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";

    if (code === "CHALLENGE_INVALID" || code === "SIGNATURE_INVALID") {
      return NextResponse.json({ error: "Validação do dispositivo inválida ou expirada." }, { status: 401 });
    }

    if (code === "ACTIVATION_CODE_INVALID" || code === "ACTIVATION_USER_INVALID") {
      return NextResponse.json({ error: "Código inválido, expirado ou já utilizado." }, { status: 400 });
    }

    if (code === "DEVICE_ALREADY_BOUND") {
      return NextResponse.json({ error: "Este dispositivo já está vinculado a outra conta ou ainda está autorizado." }, { status: 409 });
    }

    if (code === "PUBLIC_KEY_INVALID") {
      return NextResponse.json({ error: "Chave criptográfica inválida." }, { status: 400 });
    }

    console.error("device activation:", error);
    return NextResponse.json({ error: "Não foi possível ativar o dispositivo." }, { status: 500 });
  }
}
