import { NextRequest, NextResponse } from "next/server";
import { getActivationRateLimitStatus } from "@/lib/activation-rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const status = await getActivationRateLimitStatus(req);

    return NextResponse.json(
      {
        blocked: status.blocked,
        attempts: status.attempts,
        retryAfter: status.retryAfter,
        blockedUntil: status.blockedUntil,
      },
      {
        status: status.blocked ? 429 : 200,
        headers: {
          "Cache-Control": "no-store",
          ...(status.blocked ? { "Retry-After": String(status.retryAfter) } : {}),
        },
      },
    );
  } catch (error) {
    console.error("[DEVICES_ACTIVATION_STATUS]", error);

    return NextResponse.json(
      { error: "Não foi possível consultar o bloqueio de ativação." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}