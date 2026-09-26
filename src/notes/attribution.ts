/**
 * Which key and which machine created a note. Drives the source sub-icon on
 * every tile, so it has to be right: M4 is the hub, the work laptop badges as
 * its own machine, and a note made in the web app reads as "stickies".
 */
import type { Context } from "hono";
import { machineForRequestIp } from "../lib/machine-lookup.ts";
import type { Caller } from "../auth/caller.ts";

export interface Attribution { createdByKey: string | null; createdByMachine: string | null }

/** Explicit header wins. Safe chars only, capped at 64: keeps "M4", rejects junk. */
export async function machineFrom(c: Context): Promise<string | null> {
    const raw = (c.req.header("x-stickies-machine") ?? "").trim();
    if (raw) {
        const clean = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
        if (clean) return clean;
    }
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
        ?? c.req.header("x-real-ip")?.trim()
        ?? c.req.header("cf-connecting-ip")?.trim()
        ?? "";
    return machineForRequestIp(ip);
}

export async function attributionFor(c: Context, who: Caller): Promise<Attribution> {
    const createdByMachine = await machineFrom(c);
    const createdByKey =
        who.via === "apikey" ? who.label ?? null
        // The static bearer is the hardcoded label 'legacy'. Prefer the calling
        // machine so notes attribute to their origin, not to a generic label.
        : who.via === "static" ? createdByMachine ?? who.label ?? null
        : who.via === "jwt" || who.via === "local" ? "stickies"
        : null;
    return { createdByKey, createdByMachine };
}
