/** GET /live - the SSE stream every client subscribes to. */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth, caller } from "../auth/middleware.ts";
import { addClient, clientCount } from "../realtime/sse.ts";

export const live = new Hono();

live.get("/live", requireAuth, (c) =>
    streamSSE(c, async (stream) => {
        const { userId } = caller(c);
        let open = true;
        const remove = addClient(userId, (event, data) => { void stream.writeSSE({ event, data }); });
        stream.onAbort(() => { open = false; remove(); });

        await stream.writeSSE({ event: "ready", data: JSON.stringify({ clients: clientCount() }) });
        // Proxies and phone radios drop an idle connection; a comment every 25s
        // keeps it alive without being an event the client has to handle.
        while (open) {
            await stream.sleep(25_000);
            if (open) await stream.writeSSE({ event: "ping", data: "1" });
        }
    })
);
