import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, service: "logisticas-bill-backend", timestamp: new Date().toISOString() });
}
