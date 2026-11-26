-- Índices incrementais de desempenho para Turso/libSQL.
-- Execute este arquivo no banco existente; não recria tabelas nem apaga dados.

CREATE INDEX IF NOT EXISTS "Carregamento_motoristaId_data_createdAt_idx"
  ON "Carregamento"("motoristaId", "data", "createdAt");

CREATE INDEX IF NOT EXISTS "Carregamento_caminhaoId_data_createdAt_idx"
  ON "Carregamento"("caminhaoId", "data", "createdAt");

CREATE INDEX IF NOT EXISTS "Carregamento_caminhaoId_status_idx"
  ON "Carregamento"("caminhaoId", "status");

CREATE INDEX IF NOT EXISTS "CarregamentoItem_carregamentoId_statusItem_idx"
  ON "CarregamentoItem"("carregamentoId", "statusItem");
