-- Logisticas Bill 2.0
-- Campos de comprovantes de entrega.
-- Executar somente depois da revisao e validacao do schema.

ALTER TABLE "CarregamentoItem" ADD COLUMN "entregaFotoPath" TEXT;
ALTER TABLE "CarregamentoItem" ADD COLUMN "entregaFotoNome" TEXT;
ALTER TABLE "CarregamentoItem" ADD COLUMN "entregaFotoCriadaEm" DATETIME;
ALTER TABLE "CarregamentoItem" ADD COLUMN "entregueEm" DATETIME;
ALTER TABLE "CarregamentoItem" ADD COLUMN "entregaObservacao" TEXT;
ALTER TABLE "CarregamentoItem" ADD COLUMN "entregaConfirmadaPorId" TEXT;
ALTER TABLE "CarregamentoItem" ADD COLUMN "entregaConfirmadaPorNome" TEXT;

CREATE INDEX "CarregamentoItem_entregaFotoCriadaEm_idx"
ON "CarregamentoItem" ("entregaFotoCriadaEm");

CREATE INDEX "CarregamentoItem_entregue_entregueEm_idx"
ON "CarregamentoItem" ("entregue", "entregueEm");