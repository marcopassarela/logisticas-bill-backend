import { headers } from "next/headers";

export default async function BackendStatusPage() {
  const requestHeaders = await headers();
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>Logísticas Bill API</h1>
      <p>Backend online.</p>
      <p>Request ID: {requestHeaders.get("x-request-id") || "n/a"}</p>
    </main>
  );
}
