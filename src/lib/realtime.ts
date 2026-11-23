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


export function publishAuthInvalidatedForClient(clientId: string) {
  if (!clientId) return Promise.resolve();

  return publish("auth:invalidate", {
    clientId,
    reason: "access_revoked",
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

export async function removeOnlineUserPresence(identityId: string): Promise<boolean> {
  if (!identityId) return false;

  try {
    const ably = getAblyRealtimeClient();
    if (!ably) return false;

    await ably.connection.whenState("connected");

    const channel = ably.channels.get("logistica-global");
    await channel.attach();

    const members = await channel.presence.get();

    const sessionIds = members
      .filter((member) => {
        const data = member.data as { identityId?: string } | undefined;
        return data?.identityId === identityId && Boolean(member.clientId);
      })
      .map((member) => member.clientId);

    for (const sessionId of sessionIds) {
      await channel.presence.leaveClient(sessionId);
    }

    return true;
  } catch (error) {
    console.error("Falha ao remover presença no Ably:", error);
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
        const data = member.data as { identityId?: string } | undefined;
        if (data?.identityId) onlineUserIds.add(data.identityId);
      }
      page = await page.next();
    }

    return onlineUserIds;
  } catch (error) {
    console.error("Falha ao consultar usuários online no Ably:", error);
    return null;
  }
}
