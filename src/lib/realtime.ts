import { createHttpClient, createRealtimeClient } from "@ably/pubsub-server";

type AblyHttpClient = ReturnType<typeof createHttpClient>;
type AblyRealtimeClient = ReturnType<typeof createRealtimeClient>;

const globalForAbly = globalThis as typeof globalThis & {
  __logisticaAbly?: AblyHttpClient;
  __logisticaAblyRealtime?: AblyRealtimeClient;
};

function getAblyClient(): AblyHttpClient | null {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    console.error("ABLY_API_KEY não configurada.");
    return null;
  }

  if (!globalForAbly.__logisticaAbly) {
    globalForAbly.__logisticaAbly = createHttpClient({ key: apiKey });
  }

  return globalForAbly.__logisticaAbly;
}

async function publish(event: string, data: Record<string, unknown>) {
  try {
    const ably = getAblyClient();
    if (!ably) return;

    await ably.channels.get("logistica-global").publish(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Falha ao publicar evento em tempo real:", error);
  }
}

export function publishDataChanged(...modules: string[]) {
  return publish("data:changed", { modules });
}

export function publishAuthInvalidated() {
  return publish("auth:invalidate", {
    reason: "password_changed",
  });
}

function getAblyRealtimeClient(): AblyRealtimeClient | null {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) return null;

  if (!globalForAbly.__logisticaAblyRealtime) {
    globalForAbly.__logisticaAblyRealtime = createRealtimeClient({
      key: apiKey,
      clientId: "*",
    });
  }

  return globalForAbly.__logisticaAblyRealtime;
}

export async function removeOnlineUserPresence(clientId: string): Promise<boolean> {
  if (!clientId) return false;

  try {
    const ably = getAblyRealtimeClient();
    if (!ably) return false;

    await ably.connection.whenState("connected");

    const channel = ably.channels.get("logistica-global");
    await channel.attach();
    await channel.presence.leaveClient(clientId);

    return true;
  } catch (error) {
    console.error("Falha ao remover presenca no Ably:", error);
    return false;
  }
}
export async function getOnlineUserIds(): Promise<Set<string> | null> {
  try {
    const ably = getAblyClient();
    if (!ably) return null;

    const presence = ably.channels.get("logistica-global").presence;
    const onlineUserIds = new Set<string>();
    let page: Awaited<ReturnType<typeof presence.get>> | null = await presence.get();

    while (page) {
      for (const member of page.items) {
        if (member.clientId) onlineUserIds.add(member.clientId);
      }
      page = await page.next();
    }

    return onlineUserIds;
  } catch (error) {
    console.error("Falha ao consultar usuários online no Ably:", error);
    return null;
  }
}
