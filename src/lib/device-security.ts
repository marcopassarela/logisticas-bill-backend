import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePublicKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 100 || value.length > 512) {
    throw new Error("PUBLIC_KEY_INVALID");
  }

  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("PUBLIC_KEY_INVALID");
  }

  const der = Buffer.from(normalized, "base64");
  if (!der.length || der.toString("base64") !== normalized) {
    throw new Error("PUBLIC_KEY_INVALID");
  }

  let key;

  try {
    key = createPublicKey({
      key: der,
      format: "der",
      type: "spki",
    });
  } catch {
    throw new Error("PUBLIC_KEY_INVALID");
  }

  const details = key.asymmetricKeyDetails;

  if (
    key.asymmetricKeyType !== "ec" ||
    details?.namedCurve !== "prime256v1"
  ) {
    throw new Error("PUBLIC_KEY_INVALID");
  }

  return normalized;
}

export function verifyDeviceSignature(
  publicKey: string,
  challenge: string,
  signature: string,
): boolean {
  try {
    if (
      typeof signature !== "string" ||
      signature.length < 80 ||
      signature.length > 200
    ) return false;

    const signatureBuffer = Buffer.from(signature, "base64");
    if (!signatureBuffer.length || signatureBuffer.length !== 64) return false;

    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });

    return verify(
      "sha256",
      Buffer.from(challenge, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      signatureBuffer,
    );
  } catch {
    return false;
  }
}

export async function consumeChallenge(input: {
  publicKey: string;
  challenge: string;
  signature: string;
  purpose: "ACTIVATE" | "LOGIN";
}) {
  const challengeHash = sha256(input.challenge);
  const now = new Date();

  const record = await prisma.deviceChallenge.findFirst({
    where: {
      challengeHash,
      publicKey: input.publicKey,
      purpose: input.purpose,
      usedAt: null,
      expiresAt: { gt: now },
    },
  });

  if (!record) throw new Error("CHALLENGE_INVALID");

  if (!verifyDeviceSignature(input.publicKey, input.challenge, input.signature)) {
    throw new Error("SIGNATURE_INVALID");
  }

  const consumed = await prisma.deviceChallenge.updateMany({
    where: {
      id: record.id,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  if (consumed.count !== 1) throw new Error("CHALLENGE_INVALID");
}

export async function checkActivationRateLimit(
  request: NextRequest,
  scope: "ACTIVATE" | "ACTIVATE_CHALLENGE" | "LOGIN" | "LOGIN_CHALLENGE" = "ACTIVATE"
) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    request.headers.get("x-real-ip") ||
    forwarded?.split(",")[0]?.trim() ||
    "unknown";

  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET_INVALID");
  }

  const ipHash = createHash("sha256")
    .update(`${secret}:${scope}:${ip}`)
    .digest("hex");

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 900;
  const blockSeconds = 900;

  const limits = {
    ACTIVATE: 20,
    ACTIVATE_CHALLENGE: 60,
    LOGIN: 300,
    LOGIN_CHALLENGE: 120,
  } as const;

  const maxAttempts = limits[scope];

  return prisma.$transaction(async (tx) => {
    // UPSERT evita conflito de chave única na criação simultânea.
    const current = await tx.activationRateLimit.upsert({
      where: { ipHash },
      create: {
        ipHash,
        attempts: 1,
        windowStartedAt: now,
        updatedAt: now,
      },
      update: {
        attempts: { increment: 1 },
        updatedAt: now,
      },
    });

    if (current.blockedUntil && current.blockedUntil > now) {
      await tx.activationRateLimit.update({
        where: { ipHash },
        data: { attempts: maxAttempts + 1 },
      });

      return {
        blocked: true,
        retryAfter: current.blockedUntil - now,
      };
    }

    if (now - current.windowStartedAt >= windowSeconds) {
      await tx.activationRateLimit.update({
        where: { ipHash },
        data: {
          attempts: 1,
          windowStartedAt: now,
          blockedUntil: null,
          updatedAt: now,
        },
      });

      return { blocked: false, retryAfter: 0 };
    }

    const blocked = current.attempts > maxAttempts;

    if (blocked) {
      await tx.activationRateLimit.update({
        where: { ipHash },
        data: {
          attempts: maxAttempts + 1,
          blockedUntil: now + blockSeconds,
          updatedAt: now,
        },
      });
    }

    return {
      blocked,
      retryAfter: blocked ? blockSeconds : 0,
    };
  });
}
export function randomChallenge() {
  return randomBytes(32).toString("base64url");
}
