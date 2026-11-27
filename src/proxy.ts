import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { canAccess, firstAllowedPath, permissionFromPath } from "@/lib/permissions";

const COOKIE_NAME = "lb_session";

function allowedOrigins() {
  return (process.env.FRONTEND_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function withCors(response: NextResponse, request: NextRequest, requestId: string) {
  const origin = request.headers.get("origin") || "";
  if (origin && allowedOrigins().includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  if (request.method === "OPTIONS") {
    const response = withCors(new NextResponse(null, { status: 204 }), request, requestId);
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
    return response;
  }

  const pathname = request.nextUrl.pathname;
  const basePermission = permissionFromPath(pathname.replace(/^\/api\//, "/"));
  const publicEndpoint = pathname === "/api/health" || pathname === "/api/health/database" || pathname === "/api/auth/login" || pathname === "/api/auth/logout" || pathname === "/api/auth/heartbeat" || pathname === "/api/devices/challenges" || pathname === "/api/devices/activate";
  if (!basePermission || publicEndpoint || pathname === "/api/users") {
    return withCors(NextResponse.next(), request, requestId);
  }

  const detalheCarregamento = /^\/api\/carregamentos\/[^/]+$/.test(pathname);
  const action = request.method === "POST" ? "criar" : request.method === "PATCH" && !detalheCarregamento ? "editar" : request.method === "DELETE" ? "excluir" : "visualizar";
  const permission = basePermission.replace(/\.visualizar$/, `.${action}`);
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return withCors(NextResponse.json({ error: "Não autorizado" }, { status: 401 }), request, requestId);

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET não configurado");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    const role = String(payload.role || "USER");
    if (!canAccess(role, payload.permissions, permission)) {
      return withCors(NextResponse.json({ error: "Você não tem permissão para acessar este recurso." }, { status: 403 }), request, requestId);
    }
    return withCors(NextResponse.next(), request, requestId);
  } catch {
    return withCors(NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 }), request, requestId);
  }
}

export const config = { matcher: ["/api/:path*"] };
