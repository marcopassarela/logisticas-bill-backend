import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkActivationRateLimit,
  normalizePublicKey,
  randomChallenge,
  sha256,
} from "@/lib/device-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const purpose = body.purpose;

    if (purpose !== "ACTIVATE" && purpose !== "LOGIN") {
      return NextResponse.json({ error: "Finalidade inválida." }, { status: 400 });
    }

    const limit = await checkActivationRateLimit(request, purpose === "LOGIN" ? "LOGIN_CHALLENGE" : "ACTIVATE_CHALLENGE");
    if (limit.blocked) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde antes de tentar novamente.", retryAfter: limit.retryAfter },
        { status: 429 },
      );
    }

    const publicKey = normalizePublicKey(body.publicKey);

    const challenge = randomChallenge();
    const now = new Date();

    await prisma.deviceChallenge.create({
      data: {
        challengeHash: sha256(challenge),
        publicKey,
        purpose,
        expiresAt: new Date(now.getTime() + 2 * 60 * 1000),
      },
    });

    return NextResponse.json({
      ok: true,
      challenge,
      expiresIn: 120,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PUBLIC_KEY_INVALID") {
      return NextResponse.json({ error: "Chave criptográfica inválida." }, { status: 400 });
    }

    console.error("device challenge:", error);
    return NextResponse.json({ error: "Não foi possível iniciar a validação do dispositivo." }, { status: 500 });
  }
}
