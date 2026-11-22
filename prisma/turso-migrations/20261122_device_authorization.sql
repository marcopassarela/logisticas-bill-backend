-- Logisticas Bill - Turso
-- Autorizacao de dispositivos, visitantes e limite de tentativas.
-- NAO EXECUTAR antes da revisao e aprovacao.

BEGIN IMMEDIATE;

CREATE TABLE "VisitorAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Visitante',
    "permissions" JSONB,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME
);

CREATE INDEX "VisitorAccess_expiresAt_idx" ON "VisitorAccess"("expiresAt");
CREATE INDEX "VisitorAccess_revokedAt_idx" ON "VisitorAccess"("revokedAt");

CREATE TABLE "DeviceAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "visitorAccessId" TEXT,
    "publicKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "DeviceAuthorization_owner_check"
      CHECK (
        ("userId" IS NOT NULL AND "visitorAccessId" IS NULL)
        OR ("userId" IS NULL AND "visitorAccessId" IS NOT NULL)
      ),
    CONSTRAINT "DeviceAuthorization_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeviceAuthorization_visitorAccessId_fkey"
      FOREIGN KEY ("visitorAccessId") REFERENCES "VisitorAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DeviceAuthorization_publicKey_key" ON "DeviceAuthorization"("publicKey");
CREATE INDEX "DeviceAuthorization_userId_idx" ON "DeviceAuthorization"("userId");
CREATE INDEX "DeviceAuthorization_visitorAccessId_idx" ON "DeviceAuthorization"("visitorAccessId");
CREATE INDEX "DeviceAuthorization_revokedAt_idx" ON "DeviceAuthorization"("revokedAt");

CREATE TABLE "ActivationKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeHash" TEXT NOT NULL,
    "targetUserId" TEXT,
    "visitorAccessId" TEXT,
    "deviceAuthorizationId" TEXT,
    "expiresAt" DATETIME,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "closedAt" DATETIME,
    "closedReason" TEXT,
    CONSTRAINT "ActivationKey_target_check"
      CHECK (
        ("targetUserId" IS NOT NULL AND "visitorAccessId" IS NULL)
        OR ("targetUserId" IS NULL AND "visitorAccessId" IS NOT NULL)
      ),
    CONSTRAINT "ActivationKey_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivationKey_visitorAccessId_fkey"
      FOREIGN KEY ("visitorAccessId") REFERENCES "VisitorAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivationKey_deviceAuthorizationId_fkey"
      FOREIGN KEY ("deviceAuthorizationId") REFERENCES "DeviceAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ActivationKey_codeHash_key" ON "ActivationKey"("codeHash");
CREATE UNIQUE INDEX "ActivationKey_deviceAuthorizationId_key" ON "ActivationKey"("deviceAuthorizationId");
CREATE INDEX "ActivationKey_targetUserId_idx" ON "ActivationKey"("targetUserId");
CREATE INDEX "ActivationKey_visitorAccessId_idx" ON "ActivationKey"("visitorAccessId");
CREATE INDEX "ActivationKey_expiresAt_idx" ON "ActivationKey"("expiresAt");

CREATE UNIQUE INDEX "ActivationKey_one_pending_per_user"
ON "ActivationKey"("targetUserId")
WHERE "targetUserId" IS NOT NULL
  AND "usedAt" IS NULL
  AND "closedAt" IS NULL;

CREATE TABLE "DeviceChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challengeHash" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "DeviceChallenge_challengeHash_key" ON "DeviceChallenge"("challengeHash");
CREATE INDEX "DeviceChallenge_publicKey_idx" ON "DeviceChallenge"("publicKey");
CREATE INDEX "DeviceChallenge_expiresAt_idx" ON "DeviceChallenge"("expiresAt");
CREATE INDEX "DeviceChallenge_purpose_idx" ON "DeviceChallenge"("purpose");

-- Limite persistente: IP identificado por hash, nunca armazenado em texto puro.
CREATE TABLE "ActivationRateLimit" (
    "ipHash" TEXT NOT NULL PRIMARY KEY,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" INTEGER NOT NULL,
    "blockedUntil" INTEGER,
    "updatedAt" INTEGER NOT NULL
);

CREATE INDEX "ActivationRateLimit_blockedUntil_idx"
ON "ActivationRateLimit"("blockedUntil");

-- Reconstrucao de Session preservando sessoes existentes.
CREATE TABLE "Session_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "visitorAccessId" TEXT,
    "deviceAuthorizationId" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_identity_check"
      CHECK (
        ("userId" IS NOT NULL AND "visitorAccessId" IS NULL)
        OR ("userId" IS NULL AND "visitorAccessId" IS NOT NULL)
      ),
    CONSTRAINT "Session_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_visitorAccessId_fkey"
      FOREIGN KEY ("visitorAccessId") REFERENCES "VisitorAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_deviceAuthorizationId_fkey"
      FOREIGN KEY ("deviceAuthorizationId") REFERENCES "DeviceAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Session_new" (
    "id", "userId", "visitorAccessId", "deviceAuthorizationId",
    "token", "expiresAt", "createdAt"
)
SELECT "id", "userId", NULL, NULL, "token", "expiresAt", "createdAt"
FROM "Session";

DROP TABLE "Session";
ALTER TABLE "Session_new" RENAME TO "Session";

CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_visitorAccessId_idx" ON "Session"("visitorAccessId");
CREATE INDEX "Session_deviceAuthorizationId_idx" ON "Session"("deviceAuthorizationId");
CREATE INDEX "Session_token_idx" ON "Session"("token");

COMMIT;

PRAGMA foreign_key_check;