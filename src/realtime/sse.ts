/**
 * Realtime, replacing Pusher.
 *
 * The Next.js app broadcast through Pusher, which rejects events over 10KB with
 * a 413 - that is why notes over 10KB silently never arrived live. This process
 * is long-lived and holds the connections itself, so there is no third party and
 * no size cap. livePayload() is kept anyway: the slim-row + fetch-by-id path is
 * still the right move for a 200KB audit report on a phone.
 *
 * Works in Swift via URLSession.bytes and in the browser via EventSource.
 */
export type LiveEvent = "note-created" | "note-updated" | "note-deleted" | "api-request";

type Client = { id: number; userId: string; send: (event: string, data: string) => void };

const clients = new Set<Client>();
let nextId = 1;

export function addClient(userId: string, send: Client["send"]): () => void {
    const client: Client = { id: nextId++, userId, send };
    clients.add(client);
    return () => { clients.delete(client); };
}

/** Fan out to every live connection for this user. A dead socket is dropped, never thrown. */
export function broadcast(userId: string, event: LiveEvent, payload: unknown): void {
    if (clients.size === 0) return;
    const data = JSON.stringify(payload);
    for (const client of clients) {
        if (client.userId !== userId) continue;
        try { client.send(event, data); } catch { clients.delete(client); }
    }
}

export const clientCount = (): number => clients.size;
