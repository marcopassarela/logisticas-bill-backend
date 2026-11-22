import { NextResponse } from "next/server";
import {
  getCurrentIdentity,
  refreshSessionPermissions,
} from "@/lib/auth";

export async function POST() {
  const identity = await getCurrentIdentity();

  if (!identity) {
    return NextResponse.json(
      { error: "Não autorizado" },
      { status: 401 }
    );
  }

  const permissaoAtualizada =
    identity.type === "USER"
      ? await refreshSessionPermissions({
          id: identity.user.id,
          role: identity.user.role,
          permissions: identity.user.permissions,
        })
      : await refreshSessionPermissions({
          id: identity.visitor.id,
          role: "VISITOR",
          permissions: identity.visitor.permissions ?? {},
        });

  if (!permissaoAtualizada) {
    return NextResponse.json(
      { error: "Sessão inválida" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    identity: identity.type,
  });
}
