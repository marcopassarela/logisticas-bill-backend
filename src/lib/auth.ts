import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-me-in-production-min-32-chars!!"
);

const COOKIE_NAME = "lb_session";
const SESSION_DAYS = 7;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function createSession(
  userId: string,
  permissions: unknown = {},
  role = "USER",
  deviceAuthorizationId?: string
) {
  if (role !== "ADMIN" && !deviceAuthorizationId) {
    throw new Error("DEVICE_NOT_AUTHORIZED");
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await prisma.$transaction(async (tx) => {
    if (role !== "ADMIN") {
      const device = await tx.deviceAuthorization.findFirst({
        where: {
          id: deviceAuthorizationId,
          userId,
          revokedAt: null,
        },
        select: { id: true },
      });

      if (!device) {
        throw new Error("DEVICE_NOT_AUTHORIZED");
      }
    }

    await tx.session.create({
      data: {
        userId,
        token,
        expiresAt,
        deviceAuthorizationId: deviceAuthorizationId ?? null,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        lastSeenAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  });

  const jwt = await new SignJWT({
    sub: userId,
    sid: token,
    permissions,
    role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(JWT_SECRET);

  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    expires: expiresAt,
  });

  return jwt;
}

export async function createVisitorSessionRecord(
  tx: Prisma.TransactionClient,
  visitorAccessId: string,
  deviceAuthorizationId: string,
  token: string,
  expiresAt: Date
) {
  const now = new Date();

  const visitor = await tx.visitorAccess.findFirst({
    where: {
      id: visitorAccessId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  if (!visitor) throw new Error("VISITOR_ACCESS_INVALID");

  const device = await tx.deviceAuthorization.findFirst({
    where: {
      id: deviceAuthorizationId,
      visitorAccessId,
      revokedAt: null,
    },
    select: { id: true },
  });

  if (!device) throw new Error("DEVICE_NOT_AUTHORIZED");

  await tx.session.create({
    data: {
      visitorAccessId,
      deviceAuthorizationId,
      token,
      expiresAt,
    },
  });

  await tx.visitorAccess.update({
    where: { id: visitorAccessId },
    data: { lastSeenAt: now },
  });

  return visitor;
}

export async function setVisitorSessionCookie(
  visitor: { id: string; permissions: unknown },
  token: string,
  expiresAt: Date
) {
  const jwt = await new SignJWT({
    sub: visitor.id,
    sid: token,
    permissions: visitor.permissions ?? {},
    role: "VISITOR",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(JWT_SECRET);

  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    expires: expiresAt,
  });

  return jwt;
}
export async function refreshSessionPermissions(user: { id: string; role: string; permissions: unknown }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    if (payload.sub !== user.id || !sid || !exp || exp * 1000 <= Date.now()) return false;
    const refreshedJwt = await new SignJWT({ sub: user.id, sid, permissions: user.permissions, role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(JWT_SECRET);
    cookieStore.set(COOKIE_NAME, refreshedJwt, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/", expires: new Date(exp * 1000) });
    return true;
  } catch {
    return false;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;

  if (jwt) {
    try {
      const { payload } = await jwtVerify(jwt, JWT_SECRET);
      const sid = typeof payload.sid === "string" ? payload.sid : "";

      if (sid) {
        const session = await prisma.session.findUnique({
          where: { token: sid },
          select: {
            userId: true,
            visitorAccessId: true,
          },
        });

        await prisma.session.deleteMany({
          where: { token: sid },
        });

        if (session?.userId) {
          await prisma.user.update({
            where: { id: session.userId },
            data: {
              lastLogoutAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        } else if (session?.visitorAccessId) {
          await prisma.visitorAccess.update({
            where: { id: session.visitorAccessId },
            data: { lastSeenAt: new Date() },
          });
        }
      }
    } catch {
      // A sessão será encerrada localmente mesmo se a limpeza falhar.
    }
  }

  cookieStore.delete(COOKIE_NAME);
}
export async function getCurrentIdentity() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (!jwt) return null;

  try {
    const { payload } = await jwtVerify(jwt, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    const sid = typeof payload.sid === "string" ? payload.sid : "";
    if (!sid || typeof payload.sub !== "string") return null;

    const now = new Date();

    const session = await prisma.session.findUnique({
      where: { token: sid },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            cargoUsuario: true,
            funcionarioId: true,
            theme: true,
            isActive: true,
            permissions: true,
            lastSeenAt: true,
            lastLoginAt: true,
            lastLogoutAt: true,
          },
        },
        visitorAccess: {
          select: {
            id: true,
            name: true,
            permissions: true,
            expiresAt: true,
            revokedAt: true,
          },
        },
        deviceAuthorization: {
          select: {
            id: true,
            userId: true,
            visitorAccessId: true,
            revokedAt: true,
          },
        },
      },
    });

    if (!session || session.expiresAt <= now) return null;

    if (session.user && !session.visitorAccess) {
      const user = session.user;

      if (payload.sub !== user.id || !user.isActive) return null;

      if (user.role !== "ADMIN") {
        const device = session.deviceAuthorization;

        if (
          !device ||
          device.revokedAt ||
          device.userId !== user.id
        ) {
          return null;
        }
      }

      return { type: "USER" as const, user };
    }

    if (!session.user && session.visitorAccess) {
      const visitor = session.visitorAccess;
      const device = session.deviceAuthorization;

      if (
        payload.sub !== visitor.id ||
        visitor.revokedAt ||
        (visitor.expiresAt && visitor.expiresAt <= now) ||
        !device ||
        device.revokedAt ||
        device.visitorAccessId !== visitor.id
      ) {
        return null;
      }

      return { type: "VISITOR" as const, visitor };
    }

    return null;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const identity = await getCurrentIdentity();

  return identity?.type === "USER" ? identity.user : null;
}export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return user;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
  });
  if (!admin) return false;
  return verifyPassword(admin.passwordHash, password);
}



