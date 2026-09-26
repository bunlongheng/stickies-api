/** Liveness and readiness. Unauthenticated: it must answer before any session work. */
import { Hono } from "hono";
import { queryOne } from "../db.ts";
import { clientCount } from "../realtime/sse.ts";

export const health = new Hono();

health.get("/health", async (c) => {
    const started = Date.now();
    let db: "ok" | "down" = "down";
    try { await queryOne(`SELECT 1`); db = "ok"; } catch { /* reported as down */ }
    return c.json({
        ok: db === "ok",
        db,
        dbLatencyMs: Date.now() - started,
        liveClients: clientCount(),
        uptimeSec: Math.round(process.uptime()),
    }, db === "ok" ? 200 : 503, { "Cache-Control": "no-store" });
});
