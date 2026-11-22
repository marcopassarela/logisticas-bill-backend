import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  generateDeviceChallenge,
  parseDevicePublicKey,
} from "@/lib/device-crypto";

export const runtime = "nodejs";

const challengeSchema = z.object({
  publicKey: z.string().min(100).max(512),
  purpose: z.enum(["ACTIVATE", "LOGIN"]),
});

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_CHALLENGES_PER_MINUTE = 5;

export async function POST(req: NextRequest) {
  try {
    const parsed = challengeSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos para gerar o desafio." },
        { status: 400 }
      );
    }

    const { publicKey, purpose } = parsed.data;

    try {
      parseDevicePublicKey(publicKey);
    } catch {
      return NextResponse.json(
        { error: "Chave pública inválida. Utilize ECDSA P-256." },
        { status: 400 }
      );
    }

    if (purpose === "LOGIN") {
      const device = await prisma.deviceAuthorization.findFirst({
        where: { publicKey, revokedAt: null },
        include: {
          user: { select: { isActive: true } },
          visitorAccess: {
            select: { expiresAt: true, revokedAt: true },
          },
        },
      });

      const userIsActive = device?.user?.isActive === true;
      const visitorIsActive =
        !!device?.visitorAccess &&
        !device.visitorAccess.revokedAt &&
        (!device.visitorAccess.expiresAt ||
          device.visitorAccess.expiresAt > new Date());

      if (!device || (!userIsActive && !visitorIsActive)) {
        return NextResponse.json(
          { error: "Dispositivo não autorizado." },
          { status: 401 }
        );
      }
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);
    const { challenge, challengeHash } = generateDeviceChallenge();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

    const allowed = await prisma.$transaction(async (tx) => {
      const recentCount = await tx.deviceChallenge.count({
        where: {
          publicKey,
          createdAt: { gte: windowStart },
        },
      });

      if (recentCount >= MAX_CHALLENGES_PER_MINUTE) {
        return false;
      }

      await tx.deviceChallenge.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { publicKey, purpose, usedAt: null },
          ],
        },
      });

      await tx.deviceChallenge.create({
        data: { challengeHash, publicKey, purpose, expiresAt },
      });

      return true;
    });

    if (!allowed) {
      return NextResponse.json(
        { error: "Muitas solicitações. Aguarde um minuto." },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { ok: true, challenge, expiresAt: expiresAt.toISOString() },
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (error) {
    console.error("Erro ao gerar desafio do dispositivo:", error);
    return NextResponse.json(
      { error: "Não foi possível gerar o desafio." },
      { status: 500 }
    );
  }
}
