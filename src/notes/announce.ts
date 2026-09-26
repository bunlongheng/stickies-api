/**
 * The "AI activity" ticker in the web app. Only EXTERNAL callers are announced -
 * the owner's own browser traffic would otherwise announce itself back.
 */
import type { Context } from "hono";
import { broadcast } from "../realtime/sse.ts";
import type { Caller } from "../auth/caller.ts";

function summarize(body: unknown): string | undefined {
    if (Array.isArray(body)) return `batch(${body.length})`;
    if (body && typeof body === "object") {
        const o = body as Record<string, unknown>;
        if (Array.isArray(o.batch)) return `batch(${o.batch.length})`;
        const named = o.title ?? o.name ?? o.id
            ?? (o.rename_note as { title?: unknown })?.title
            ?? (o.rename_folder as { from?: unknown })?.from;
        if (typeof named === "string") return named;
    }
    return undefined;
}

export function announceRequest(c: Context, who: Caller, body?: unknown): void {
    if (who.type !== "external") return;
    const url = new URL(c.req.url);
    broadcast(who.userId, "api-request", {
        method: c.req.method,
        path: url.pathname + (url.search || ""),
        ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("cf-connecting-ip") ?? "unknown",
        ua: (c.req.header("user-agent") ?? "").slice(0, 80),
        auth: who.type,
        at: new Date().toISOString(),
        summary: summarize(body),
    });
}
