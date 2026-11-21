import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-libsql",
    "@libsql/client",
  ],
  outputFileTracingExcludes: {
    "/*": [
      "./.env",
      "./README.md",
      "./MIGRACAO_FRONTEND.md",
      "./node_modules/.prisma/client/query_engine-windows.dll.node",
      "./public/**/*",
      "./teste-*.cjs",
"./auditoria-migracao.cjs",
"./diagnostico-*.cjs",
"./migrar-aiven-para-turso.cjs",
"./verificar-migracao.ps1",
      "./turso_schema.sql",
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
