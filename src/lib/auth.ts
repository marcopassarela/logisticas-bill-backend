import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// The frontend uses the Render backend when BACKEND_API_URL is configured.
// Prisma is loaded on demand to avoid opening Aiven/PostgreSQL on Vercel.
async function getLocalPrisma() {
  const { prisma } = await import("./prisma");
  return prisma;
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-me-in-production-min-32-chars!!"
);

const COOKIE_NAME = "lb_session";
const SESSION_DAYS = 7;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    // Balanced parameters for serverless (Render/Vercel) - faster and still secure.
    memoryCost: 19456, // ~19 MB
    timeCost: 2,
    parallelism: 1,
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
  const prisma = await getLocalPrisma();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await prisma.$transaction([
    prisma.session.create({ data: { userId, deviceAuthorizationId: deviceAuthorizationId ?? null, token, expiresAt } }),
    prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(), lastLoginAt: new Date() } }),
  ]);

  const jwt = await new SignJWT({ sub: userId, sid: token, permissions, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(JWT_SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return jwt;
}

export async function refreshSessionPermissions(user: {
  id: string;
  role: string;
  permissions: unknown;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    const sid = typeof payload.sid === "string" ? payload.sid : "";
    const exp = typeof payload.exp === "number" ? payload.exp : 0;

    if (
      payload.sub !== user.id ||
      !sid ||
      !exp ||
      exp * 1000 <= Date.now()
    ) {
      return false;
    }

    const prisma = await getLocalPrisma();

    const session = await prisma.session.findUnique({
      where: { token: sid },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            permissions: true,
            isActive: true,
          },
        },
        deviceAuthorization: {
          select: {
            id: true,
            userId: true,
            revokedAt: true,
          },
        },
      },
    });

    if (
      !session ||
      !session.user ||
      session.userId !== user.id ||
      session.user.id !== user.id ||
      !session.user.isActive ||
      session.expiresAt <= new Date()
    ) {
      return false;
    }

    if (session.user.role !== "ADMIN") {
      const device = session.deviceAuthorization;

      if (
        !device ||
        device.userId !== user.id ||
        device.revokedAt !== null
      ) {
        return false;
      }
    }

    const refreshedJwt = await new SignJWT({
      sub: user.id,
      sid,
      permissions: session.user.permissions,
      role: session.user.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(JWT_SECRET);

    cookieStore.set(COOKIE_NAME, refreshedJwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(exp * 1000),
    });

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
      const sid = payload.sid as string;
      if (sid) {
        const prisma = await getLocalPrisma();
        const session = await prisma.session.findUnique({ where: { token: sid }, select: { userId: true } });
        await prisma.session.deleteMany({ where: { token: sid } });
        if (session?.userId) await prisma.user.update({ where: { id: session.userId }, data: { lastLogoutAt: new Date(), lastSeenAt: new Date() } });
      }
    } catch {
      // ignore
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (!jwt) return null;


  try {
    const { payload } = await jwtVerify(jwt, JWT_SECRET);
    const userId = payload.sub as string;
    const sid = payload.sid as string;
    const prisma = await getLocalPrisma();

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
        deviceAuthorization: {
          select: {
            id: true,
            userId: true,
            revokedAt: true,
          },
        },
      },
    });

    if (
      !session ||
      !session.user ||
      session.userId !== userId ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      return null;
    }

    if (session.user.role !== "ADMIN") {
      const device = session.deviceAuthorization;

      if (
        !device ||
        device.userId !== session.user.id ||
        device.revokedAt !== null
      ) {
        return null;
      }
    }

    return session.user;
  } catch {
    return null;
  }
}

export async function requireAuth() {
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
  const prisma = await getLocalPrisma();
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
  });
  if (!admin) return false;
  return verifyPassword(admin.passwordHash, password);
}
