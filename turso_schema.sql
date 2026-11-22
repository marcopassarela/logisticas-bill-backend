-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "permissions" JSONB,
    "lastSeenAt" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLogoutAt" DATETIME,
    "cargoUsuario" TEXT,
    "funcionarioId" TEXT,
    CONSTRAINT "User_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Funcionario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "cargoId" TEXT,
    "dataAdmissao" DATETIME,
    "salario" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "observacoes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Funcionario_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cargo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Caminhao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "placa" TEXT NOT NULL,
    "modelo" TEXT,
    "marca" TEXT,
    "ano" INTEGER,
    "capacidadeKg" DECIMAL,
    "tipo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LIBERADO',
    "quilometragem" INTEGER,
    "renavam" TEXT,
    "chassi" TEXT,
    "observacoes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Carregamento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caminhaoId" TEXT NOT NULL,
    "data" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pesoTotal" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "observacoes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "destino" TEXT,
    "origem" TEXT,
    "ajudanteId" TEXT,
    "motoristaId" TEXT,
    CONSTRAINT "Carregamento_ajudanteId_fkey" FOREIGN KEY ("ajudanteId") REFERENCES "Funcionario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Carregamento_caminhaoId_fkey" FOREIGN KEY ("caminhaoId") REFERENCES "Caminhao" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Carregamento_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "Funcionario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CarregamentoItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carregamentoId" TEXT NOT NULL,
    "quantidade" DECIMAL NOT NULL,
    "peso" DECIMAL NOT NULL,
    "observacao" TEXT,
    "statusItem" TEXT NOT NULL DEFAULT 'PENDENTE',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "descricaoLivre" TEXT,
    "ordemServico" TEXT,
    "clienteNome" TEXT,
    "clienteTelefone" TEXT,
    "clienteCidade" TEXT,
    "clienteBairro" TEXT,
    "mapaUrl" TEXT,
    "notaFiscalNome" TEXT,
    "notaFiscalData" BLOB,
    "notaFiscalPath" TEXT,
    "pdfExiste" BOOLEAN NOT NULL DEFAULT false,
    "notaFiscalDisponivel" BOOLEAN NOT NULL DEFAULT false,
    "mapaUrl2" TEXT,
    CONSTRAINT "CarregamentoItem_carregamentoId_fkey" FOREIGN KEY ("carregamentoId") REFERENCES "Carregamento" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Diaria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funcionarioId" TEXT NOT NULL,
    "caminhaoId" TEXT,
    "data" DATETIME NOT NULL,
    "valor" DECIMAL NOT NULL,
    "observacao" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Diaria_caminhaoId_fkey" FOREIGN KEY ("caminhaoId") REFERENCES "Caminhao" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Diaria_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Diaria_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Falta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funcionarioId" TEXT NOT NULL,
    "data" DATETIME NOT NULL,
    "tipo" TEXT NOT NULL,
    "justificativa" TEXT,
    "atestadoUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Falta_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Falta_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "origemLat" REAL,
    "origemLng" REAL,
    "destinoLat" REAL,
    "destinoLng" REAL,
    "distanciaKm" REAL,
    "caminhaoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANEJADA',
    "observacoes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dataProgramada" TEXT,
    CONSTRAINT "Rota_caminhaoId_fkey" FOREIGN KEY ("caminhaoId") REFERENCES "Caminhao" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RotaPonto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rotaId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nome" TEXT,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "endereco" TEXT,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RotaPonto_rotaId_fkey" FOREIGN KEY ("rotaId") REFERENCES "Rota" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alerta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'INFO',
    "lido" BOOLEAN NOT NULL DEFAULT false,
    "referencia" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnderecoFavorito" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "pasta" TEXT NOT NULL DEFAULT 'Favoritos'
);

-- CreateTable
CREATE TABLE "AgendamentoCarregamento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "caminhaoId" TEXT NOT NULL,
    "peso" DECIMAL NOT NULL,
    "dataHora" DATETIME NOT NULL,
    "origem" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGENDADO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "alertaGeradoEm" DATETIME,
    CONSTRAINT "AgendamentoCarregamento_caminhaoId_fkey" FOREIGN KEY ("caminhaoId") REFERENCES "Caminhao" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgendamentoCarregamento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManutencaoProgramada" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "caminhaoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dataHora" DATETIME,
    "quilometragemAlvo" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "alertaGeradoEm" DATETIME,
    CONSTRAINT "ManutencaoProgramada_caminhaoId_fkey" FOREIGN KEY ("caminhaoId") REFERENCES "Caminhao" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManutencaoProgramada_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lembrete" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dataHora" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "enviadoEm" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "processandoEm" DATETIME,
    CONSTRAINT "Lembrete_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_funcionarioId_key" ON "User"("funcionarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Funcionario_cpf_key" ON "Funcionario"("cpf");

-- CreateIndex
CREATE INDEX "Funcionario_nome_idx" ON "Funcionario"("nome");

-- CreateIndex
CREATE INDEX "Funcionario_status_idx" ON "Funcionario"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Cargo_nome_key" ON "Cargo"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Caminhao_placa_key" ON "Caminhao"("placa");

-- CreateIndex
CREATE INDEX "Caminhao_placa_idx" ON "Caminhao"("placa");

-- CreateIndex
CREATE INDEX "Caminhao_status_idx" ON "Caminhao"("status");

-- CreateIndex
CREATE INDEX "Carregamento_data_idx" ON "Carregamento"("data");

-- CreateIndex
CREATE INDEX "Carregamento_status_idx" ON "Carregamento"("status");

-- CreateIndex
CREATE INDEX "Carregamento_caminhaoId_idx" ON "Carregamento"("caminhaoId");

-- CreateIndex
CREATE INDEX "Carregamento_motoristaId_idx" ON "Carregamento"("motoristaId");

-- CreateIndex
CREATE INDEX "Carregamento_ajudanteId_idx" ON "Carregamento"("ajudanteId");

-- CreateIndex
CREATE INDEX "CarregamentoItem_carregamentoId_notaFiscalDisponivel_idx" ON "CarregamentoItem"("carregamentoId", "notaFiscalDisponivel");

-- CreateIndex
CREATE INDEX "CarregamentoItem_carregamentoId_idx" ON "CarregamentoItem"("carregamentoId");

-- CreateIndex
CREATE INDEX "Diaria_data_idx" ON "Diaria"("data");

-- CreateIndex
CREATE INDEX "Diaria_funcionarioId_idx" ON "Diaria"("funcionarioId");

-- CreateIndex
CREATE INDEX "Falta_data_idx" ON "Falta"("data");

-- CreateIndex
CREATE INDEX "Falta_funcionarioId_idx" ON "Falta"("funcionarioId");

-- CreateIndex
CREATE INDEX "Rota_status_idx" ON "Rota"("status");

-- CreateIndex
CREATE INDEX "Rota_dataProgramada_idx" ON "Rota"("dataProgramada");

-- CreateIndex
CREATE INDEX "Alerta_lido_idx" ON "Alerta"("lido");

-- CreateIndex
CREATE INDEX "Alerta_createdAt_idx" ON "Alerta"("createdAt");

-- CreateIndex
CREATE INDEX "Alerta_tipo_referencia_idx" ON "Alerta"("tipo", "referencia");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_action_entity_entityId_idx" ON "AuditLog"("action", "entity", "entityId");

-- CreateIndex
CREATE INDEX "EnderecoFavorito_createdAt_idx" ON "EnderecoFavorito"("createdAt");

-- CreateIndex
CREATE INDEX "AgendamentoCarregamento_status_dataHora_idx" ON "AgendamentoCarregamento"("status", "dataHora");

-- CreateIndex
CREATE INDEX "AgendamentoCarregamento_caminhaoId_idx" ON "AgendamentoCarregamento"("caminhaoId");

-- CreateIndex
CREATE INDEX "AgendamentoCarregamento_userId_idx" ON "AgendamentoCarregamento"("userId");

-- CreateIndex
CREATE INDEX "ManutencaoProgramada_status_dataHora_idx" ON "ManutencaoProgramada"("status", "dataHora");

-- CreateIndex
CREATE INDEX "ManutencaoProgramada_caminhaoId_quilometragemAlvo_idx" ON "ManutencaoProgramada"("caminhaoId", "quilometragemAlvo");

-- CreateIndex
CREATE INDEX "ManutencaoProgramada_userId_idx" ON "ManutencaoProgramada"("userId");

-- CreateIndex
CREATE INDEX "Lembrete_userId_status_dataHora_idx" ON "Lembrete"("userId", "status", "dataHora");

-- CreateIndex
CREATE INDEX "Lembrete_status_dataHora_idx" ON "Lembrete"("status", "dataHora");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

