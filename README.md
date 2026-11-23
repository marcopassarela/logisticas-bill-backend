# Logísticas Bill Backend

Backend Next.js separado para o Logísticas Bill. A aplicação contém as regras de negócio, autenticação, autorização, transações Prisma e integração com o Turso/libSQL. O frontend Vercel não deve receber credenciais do banco.

## Arquitetura

- Frontend: Vercel, somente interface e chamadas HTTP.
- Backend: Render, Next.js App Router API routes.
- Banco: Turso/libSQL, acessado exclusivamente pelo backend.
- Sessão: cookie HttpOnly `lb_session`, assinado com `JWT_SECRET`.
- Arquivos: Vercel Blob quando `BLOB_READ_WRITE_TOKEN` estiver configurado.
- Realtime: Ably quando `ABLY_API_KEY` estiver configurado.

## Render

1. Aponte o serviço para este repositório.
2. Use `render.yaml` ou configure manualmente os comandos `npm ci --include=dev && npx prisma generate && npm run build` e `npm start`.
3. Configure todas as variáveis de `.env.example` no painel do Render. O backend usa somente `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`; não configure `DATABASE_URL` ou `DIRECT_URL`.
4. Use `/api/health` como health check.
5. Na primeira configuração do banco, execute `npm run db:setup` uma única vez com as variáveis do Turso configuradas. O pacote não usa migrations PostgreSQL.

## Execução local no Windows/PowerShell

Antes de executar a preparação do banco, crie um arquivo `.env` na raiz do backend e informe as credenciais do Turso:

```powershell
Copy-Item .env.example .env
notepad .env
npm.cmd run db:setup
npm.cmd start
```

O script `start` usa automaticamente a variável `PORT` definida pelo Render e a porta padrão do Next.js localmente. Não é necessário utilizar sintaxe Bash como `${PORT:-10000}` no PowerShell.

## Frontend

Configure na Vercel:

```text
BACKEND_API_URL=https://SEU-SERVICO.onrender.com
```

A configuração do frontend encaminha `/api/*` ao backend. Remova `DATABASE_URL`, `DIRECT_URL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ABLY_API_KEY` e `BLOB_READ_WRITE_TOKEN` do frontend quando confirmar o deploy do backend.

## Segurança operacional

- Nunca versionar `.env`, tokens ou certificados.
- Use HTTPS no Render e na Vercel.
- Restrinja `FRONTEND_ORIGINS` aos domínios reais.
- Mantenha `JWT_SECRET` estável durante a vida das sessões.
- Mantenha `TURSO_AUTH_TOKEN` somente no Render e nunca no frontend, Git ou ZIP entregue.
