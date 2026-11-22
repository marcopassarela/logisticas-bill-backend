import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createVisitorSessionRecord,
  setVisitorSessionCookie,
} from "@/lib/auth";
import {
  hashDeviceChallenge,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from "@/lib/device-crypto";
import {
  clearActivationFailures,
  getActivationRateLimitStatus,
  recordActivationFailure,
} from "@/lib/activation-rate-limit";

export const runtime = "nodejs";

const activationSchema = z.object({
  code: z.string().trim().regex(
    /^LB-(?:[A-F0-9]{4}-){9}[A-F0-9]{4}$/i
  ),
  publicKey: z.string().min(100).max(512),
  challenge: z.string().min(20).max(128),
  signature: z.string().min(80).max(128),
});

function hashActivationCode(code: string) {
  return createHash("sha256")
    .update(code.trim().toUpperCase())
    .digest("hex");
}

function blockedResponse(retryAfter: number, blockedUntil: number) {
  return NextResponse.json(
    {
      error: "Muitas tentativas de ativação. Aguarde antes de tentar novamente.",
      blocked: true,
      retryAfter,
      blockedUntil,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const parsed = activationSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados de ativação inválidos." },
        { status: 400 }
      );
    }

    const { code, publicKey, challenge, signature } = parsed.data;

    try {
      parseDevicePublicKey(publicKey);
    } catch {
      return NextResponse.json(
        { error: "Chave pública inválida." },
        { status: 400 }
      );
    }

    if (!verifyDeviceSignature(publicKey, challenge, signature)) {
      return NextResponse.json(
        { error: "Comprovação criptográfica inválida." },
        { status: 401 }
      );
    }

    const rateStatus = await getActivationRateLimitStatus(req);

    if (rateStatus.blocked && rateStatus.blockedUntil) {
      return blockedResponse(
        rateStatus.retryAfter,
        rateStatus.blockedUntil
      );
    }

    const now = new Date();
    const codeHash = hashActivationCode(code);
    const challengeHash = hashDeviceChallenge(challenge);

    // O desafio é consumido em uma transação independente.
    // Uma falha posterior na chave não desfaz esse consumo.
    const consumedChallenge = await prisma.deviceChallenge.updateMany({
      where: {
        challengeHash,
        publicKey,
        purpose: "ACTIVATE",
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (consumedChallenge.count !== 1) {
      return NextResponse.json(
        {
          error: "Desafio expirado, utilizado ou inválido. Gere outro.",
        },
        { status: 401 }
      );
    }

    const sessionToken = randomUUID() + randomUUID();
    const sessionExpiresAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );

    let result;

    try {
      result = await prisma.$transaction(async (tx) => {
        const claimedKey = await tx.activationKey.updateMany({
          where: {
            codeHash,
            usedAt: null,
            closedAt: null,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
          data: { usedAt: now },
        });

        if (claimedKey.count !== 1) {
          throw new Error("ACTIVATION_KEY_INVALID");
        }

        const key = await tx.activationKey.findUnique({
          where: { codeHash },
          select: {
            id: true,
            targetUserId: true,
            visitorAccessId: true,
          },
        });

        if (!key || (!!key.targetUserId === !!key.visitorAccessId)) {
          throw new Error("ACTIVATION_TARGET_INVALID");
        }

        if (key.targetUserId) {
          const user = await tx.user.findFirst({
            where: {
              id: key.targetUserId,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              username: true,
            },
          });

          if (!user) throw new Error("USER_INACTIVE");

          const device = await tx.deviceAuthorization.create({
            data: {
              userId: user.id,
              publicKey,
            },
            select: { id: true },
          });

          await tx.activationKey.update({
            where: { id: key.id },
            data: { deviceAuthorizationId: device.id },
          });

          return {
            type: "USER" as const,
            user,
          };
        }

        const visitor = await tx.visitorAccess.findFirst({
          where: {
            id: key.visitorAccessId!,
            revokedAt: null,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        });

        if (!visitor) throw new Error("VISITOR_ACCESS_INVALID");

        const device = await tx.deviceAuthorization.create({
          data: {
            visitorAccessId: visitor.id,
            publicKey,
          },
          select: { id: true },
        });

        await tx.activationKey.update({
          where: { id: key.id },
          data: { deviceAuthorizationId: device.id },
        });

        const sessionVisitor = await createVisitorSessionRecord(
          tx,
          visitor.id,
          device.id,
          sessionToken,
          sessionExpiresAt
        );

        return {
          type: "VISITOR" as const,
          visitor: sessionVisitor,
        };
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "";

      if (errorCode === "ACTIVATION_KEY_INVALID") {
        const failureStatus = await recordActivationFailure(req);

        if (failureStatus.blocked && failureStatus.blockedUntil) {
          return blockedResponse(
            failureStatus.retryAfter,
            failureStatus.blockedUntil
          );
        }

        return NextResponse.json(
          {
            error: "Chave inválida, expirada ou já utilizada.",
            attempts: failureStatus.attempts,
            remainingAttempts: Math.max(0, 5 - failureStatus.attempts),
          },
          { status: 400 }
        );
      }

      throw error;
    }

    // Uma ativação concluída limpa o histórico de falhas daquele IP.
    await clearActivationFailures(req);

    if (result.type === "VISITOR") {
      await setVisitorSessionCookie(
        result.visitor,
        sessionToken,
        sessionExpiresAt
      );

      return NextResponse.json({
        ok: true,
        identity: {
          type: "VISITOR",
          id: result.visitor.id,
          name: result.visitor.name,
          role: "VISITOR",
        },
        message: "Chave ativada com sucesso!",
      });
    }

    return NextResponse.json({
      ok: true,
      identity: {
        type: "USER",
        id: result.user.id,
        name: result.user.name,
        username: result.user.username,
      },
      message: "Chave ativada com sucesso!",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";

    const errors: Record<string, { message: string; status: number }> = {
      CHALLENGE_INVALID: {
        message: "Desafio expirado, utilizado ou inválido. Gere outro.",
        status: 401,
      },
      ACTIVATION_TARGET_INVALID: {
        message: "Destino da ativação inválido.",
        status: 400,
      },
      USER_INACTIVE: {
        message: "O usuário não está ativo.",
        status: 403,
      },
      VISITOR_ACCESS_INVALID: {
        message: "O acesso de visitante expirou ou foi revogado.",
        status: 403,
      },
      DEVICE_NOT_AUTHORIZED: {
        message: "Dispositivo não autorizado.",
        status: 403,
      },
    };

    if (errors[code]) {
      return NextResponse.json(
        { error: errors[code].message },
        { status: errors[code].status }
      );
    }

    console.error("Erro na ativação do dispositivo:", error);

    return NextResponse.json(
      { error: "Não foi possível ativar este dispositivo." },
      { status: 500 }
    );
  }
}