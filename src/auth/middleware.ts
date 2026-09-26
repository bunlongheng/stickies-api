/**
 * Route guards. `requireAuth` resolves the caller once and stashes it; every
 * handler reads it with `caller(c)` instead of authenticating a second time.
 */
import type { Context, MiddlewareHandler } from "hono";
import { identifyCaller, type Caller } from "./caller.ts";

declare module "hono" {
    interface ContextVariableMap { caller: Caller }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
    const found = await identifyCaller(c);
    if (!found) return c.json({ error: "Unauthorized" }, 401);
    c.set("caller", found);
    await next();
};

/**
 * Owner-only in the strict sense the key-management route needs: a machine key
 * may act as the owner everywhere else, but must not be able to mint or revoke
 * keys. Only a real person (browser session or LAN) passes.
 */
export const requireOwnerPerson: MiddlewareHandler = async (c, next) => {
    const found = c.get("caller");
    if (found.via !== "local" && found.via !== "jwt") {
        return c.json({ error: "Key management is owner-only. Machine keys cannot manage keys." }, 403);
    }
    await next();
};

/** Deletes are owner-browser-only, so a leaked key can never destroy notes. */
export const forbidExternal: MiddlewareHandler = async (c, next) => {
    if (c.get("caller").type === "external") {
        return c.json({
            error: "Deletion is not permitted via API key.",
            message: "Notes can only be deleted from the owner's browser session.",
        }, 403);
    }
    await next();
};

export const caller = (c: Context): Caller => c.get("caller");
