import { NextResponse } from "next/server";
import { getCurrentIdentity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOnlineUserIds } from "@/lib/realtime";

export async function POST() {
  const identity = await getCurrentIdentity();

  if (!identity) {
    return NextResponse.json(
      { error: "Não autorizado" },
      { status: 401 }
    );
  }

  const identityId =
    identity.type === "USER" ? identity.user.id : identity.visitor.id;

  const onlineUserIds = await getOnlineUserIds();

  if (!onlineUserIds) {
    return NextResponse.json(
      { error: "Não foi possível verificar a presença" },
      { status: 503 }
    );
  }

  if (onlineUserIds.has(identityId)) {
    return NextResponse.json({ ok: true, online: true });
  }

  const lastSeenAt = new Date();

  if (identity.type === "USER") {
    await prisma.user.update({
      where: { id: identity.user.id },
      data: { lastSeenAt },
    });
  } else {
    await prisma.visitorAccess.update({
      where: { id: identity.visitor.id },
      data: { lastSeenAt },
    });
  }

  return NextResponse.json({
    ok: true,
    online: false,
    lastSeenAt: lastSeenAt.toISOString(),
  });
}
