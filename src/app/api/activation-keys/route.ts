import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

function generateCode() {
  return randomBytes(4).toString("hex").toUpperCase() + "-" + randomBytes(4).toString("hex").toUpperCase();
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Somente administradores." }, { status: 403 });
  }

  const keys = await prisma.activationKey.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      usedByUser: { select: { id: true, username: true, name: true } },
    },
  });

  return NextResponse.json(keys);
}

/**
 * POST { label?, neverExpires?, expiresAt? }
 * neverExpires=true → chave sem data de expiração
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Somente administradores." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label.trim() || null : null;
    const neverExpires = body.neverExpires === true;
    let expiresAt: Date | null = null;

    if (!neverExpires) {
      if (typeof body.expiresAt === "string" && body.expiresAt) {
        expiresAt = new Date(body.expiresAt);
        if (Number.isNaN(expiresAt.getTime())) {
          return NextResponse.json({ error: "Data de expiração inválida." }, { status: 400 });
        }
      } else {
        // padrão: 30 dias
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    }

    const key = await prisma.activationKey.create({
      data: {
        id: crypto.randomUUID(),
        code: generateCode(),
        label,
        neverExpires,
        expiresAt,
        isActive: true,
      },
    });

    return NextResponse.json(key, { status: 201 });
  } catch (error) {
    console.error("activation-keys POST:", error);
    return NextResponse.json({ error: "Não foi possível criar a chave." }, { status: 500 });
  }
}

/** DELETE { id } */
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Somente administradores." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "ID da chave obrigatório." }, { status: 400 });
    }

    await prisma.activationKey.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("activation-keys DELETE:", error);
    return NextResponse.json({ error: "Não foi possível excluir a chave." }, { status: 500 });
  }
}
