import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

function getIpHash(req: NextRequest): string {
  const ip = req.headers.get("cf-connecting-ip")?.trim();

  if (!ip || !isIP(ip)) {
    throw new Error("TRUSTED_CLIENT_IP_UNAVAILABLE");
  }

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ACTIVATION_RATE_LIMIT_SECRET_UNAVAILABLE");
  }

  return createHmac("sha256", secret)
    .update(ip)
    .digest("hex");
}
export type ActivationRateLimitStatus = {
  blocked: boolean;
  attempts: number;
  retryAfter: number;
  blockedUntil: number | null;
};

export async function getActivationRateLimitStatus(
  req: NextRequest,
): Promise<ActivationRateLimitStatus> {
  const ipHash = getIpHash(req);
  const now = Math.floor(Date.now() / 1000);

  const records = await prisma.$queryRaw<
    Array<{
      attempts: number;
      windowStartedAt: number;
      blockedUntil: number | null;
    }>
  >`
    SELECT "attempts", "windowStartedAt", "blockedUntil"
    FROM "ActivationRateLimit"
    WHERE "ipHash" = ${ipHash}
    LIMIT 1
  `;

  const record = records[0];

  if (!record) {
    return {
      blocked: false,
      attempts: 0,
      retryAfter: 0,
      blockedUntil: null,
    };
  }

  if (record.blockedUntil && record.blockedUntil > now) {
    return {
      blocked: true,
      attempts: record.attempts,
      retryAfter: record.blockedUntil - now,
      blockedUntil: record.blockedUntil,
    };
  }

  if (now - record.windowStartedAt >= WINDOW_SECONDS) {
    return {
      blocked: false,
      attempts: 0,
      retryAfter: 0,
      blockedUntil: null,
    };
  }

  return {
    blocked: false,
    attempts: record.attempts,
    retryAfter: 0,
    blockedUntil: null,
  };
}

export async function recordActivationFailure(
  req: NextRequest,
): Promise<ActivationRateLimitStatus> {
  const ipHash = getIpHash(req);
  const now = Math.floor(Date.now() / 1000);

  await prisma.$executeRaw`
    INSERT INTO "ActivationRateLimit"
      ("ipHash", "attempts", "windowStartedAt", "blockedUntil", "updatedAt")
    VALUES
      (${ipHash}, 1, ${now}, NULL, ${now})
    ON CONFLICT("ipHash") DO UPDATE SET
      "attempts" = CASE
        WHEN "ActivationRateLimit"."blockedUntil" IS NOT NULL
          AND "ActivationRateLimit"."blockedUntil" > ${now}
          THEN "ActivationRateLimit"."attempts"
        WHEN "ActivationRateLimit"."windowStartedAt" <= ${now - WINDOW_SECONDS}
          THEN 1
        ELSE "ActivationRateLimit"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "ActivationRateLimit"."blockedUntil" IS NOT NULL
          AND "ActivationRateLimit"."blockedUntil" > ${now}
          THEN "ActivationRateLimit"."windowStartedAt"
        WHEN "ActivationRateLimit"."windowStartedAt" <= ${now - WINDOW_SECONDS}
          THEN ${now}
        ELSE "ActivationRateLimit"."windowStartedAt"
      END,
      "blockedUntil" = CASE
        WHEN "ActivationRateLimit"."blockedUntil" IS NOT NULL
          AND "ActivationRateLimit"."blockedUntil" > ${now}
          THEN "ActivationRateLimit"."blockedUntil"
        WHEN "ActivationRateLimit"."windowStartedAt" <= ${now - WINDOW_SECONDS}
          THEN NULL
        WHEN "ActivationRateLimit"."attempts" + 1 >= ${MAX_ATTEMPTS}
          THEN ${now + WINDOW_SECONDS}
        ELSE NULL
      END,
      "updatedAt" = ${now}
  `;

  return getActivationRateLimitStatus(req);
}

export async function clearActivationFailures(
  req: NextRequest,
): Promise<void> {
  const ipHash = getIpHash(req);

  await prisma.$executeRaw`
    DELETE FROM "ActivationRateLimit" WHERE "ipHash" = ${ipHash}
  `;
}