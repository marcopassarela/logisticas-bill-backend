import { NextResponse } from "next/server";
import { createHttpClient } from "@ably/pubsub-server";
import { getCurrentIdentity } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const identity = await getCurrentIdentity();

    if (!identity) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    const apiKey = process.env.ABLY_API_KEY;

    if (!apiKey) {
      console.error("ABLY_API_KEY não configurada.");
      return NextResponse.json(
        { error: "Serviço de comunicação indisponível" },
        { status: 503 }
      );
    }

    const clientId = identity.sessionId;

    const ably = createHttpClient({ key: apiKey });

    const tokenRequest = await ably.auth.createTokenRequest({
      clientId,
      capability: {
        "logistica-global": ["subscribe", "presence"],
      },
    });

    return NextResponse.json(tokenRequest, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Erro ao gerar token Ably:", error);

    return NextResponse.json(
      { error: "Não foi possível autenticar no serviço de comunicação" },
      { status: 500 }
    );
  }
}
