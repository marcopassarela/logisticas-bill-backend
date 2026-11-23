# Migração do frontend para o backend Render

No frontend Vercel, configure `BACKEND_API_URL` com a URL HTTPS do Render. O `next.config.ts` atualizado encaminha as chamadas `/api/*` para o backend antes das rotas locais.

Após confirmar o funcionamento no Render:

1. Remova `DATABASE_URL`, `DIRECT_URL`, `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` da Vercel.
2. Remova `ABLY_API_KEY`, `BLOB_READ_WRITE_TOKEN` e demais segredos que só o backend utiliza.
3. Mantenha `JWT_SECRET` somente no Render; ele deve ser igual no frontend apenas se o middleware local continuar validando o JWT. A etapa final recomendada é retirar a validação JWT do middleware do frontend e deixar a autorização no backend.
4. Faça deploy do frontend e teste login, logout, carregamentos, notas fiscais, usuários, permissões e realtime.
5. Monitore `/api/health` e os logs do Render.

A primeira fase usa rewrites para preservar as URLs atuais das telas. Isso reduz o risco de alterar dezenas de componentes de uma só vez, mas todas as transações e validações passam a ser executadas pelo backend.
