/**
 * Who is behind this request. Ported from the Next.js app's _auth.ts +
 * route.ts authenticate(), which had drifted into 2 copies of the same key
 * lookup. One copy here, one accept order, used by every route.
 *
 * Accept order:
 *  1. Static STICKIES_API_KEY bearer (timing-safe)  -> external, label 'legacy'
 *  2. Per-key row in api_keys (sha-256)             -> external, its own label
 *  3. Access JWT issued by this service             -> owner or user
 *  4. LAN/local trust (dev, or the hub opting in)   -> owner
 */
import crypto from "node:crypto";
import type { Context } from "hono";
import { env } from "../env.ts";
import { query, execute } from "../db.ts";
import { hashApiKey } from "../lib/api-keys.ts";
import { verifyAccessToken } from "./jwt.ts";

/** Label stamped on notes created with the shared static secret. */
export const STATIC_KEY_LABEL = "legacy";

export type CallerVia = "static" | "apikey" | "jwt" | "local";
export interface Caller {
    /** 'external' is a keyed script or agent. 'owner'/'user' are people in a browser or the native app. */
    type: "external" | "owner" | "user";
    userId: string;
    via: CallerVia;
    label?: string;
    keyId?: string;
}

function timingSafeMatch(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

type KeyLookup =
    | { status: "match"; id: string; label: string }
    | { status: "not_found" }
    | { status: "prod_locked" };

/** Active per-machine key by sha-256 hash, with the prod label gate applied. */
export async function lookupApiKey(bearer: string): Promise<KeyLookup> {
    try {
        const rows = await query<{ id: string; label: string }>(
            `SELECT id, label FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
            [hashApiKey(bearer)]
        );
        const row = rows[0];
        if (!row) return { status: "not_found" };
        if (env.prodLocked && row.label !== env.prodKeyLabel) return { status: "prod_locked" };
        // Fire-and-forget: never block the request on an access-log write.
        execute(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
        return { status: "match", id: row.id, label: row.label };
    } catch { return { status: "not_found" }; }
}

const LOCAL_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|.*\.local|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i;

/**
 * Keyless owner access for LAN callers. Always on outside production. In
 * production it is OFF unless the process opts in with STICKIES_LAN_TRUST=1,
 * which only the M4 hub sets so a production build can serve LAN devices.
 */
function lanTrusted(c: Context): boolean {
    const host = c.req.header("host") ?? "";
    if (!LOCAL_RE.test(host)) return false;
    return !env.isProd || env.lanTrust;
}

export async function identifyCaller(c: Context): Promise<Caller | null> {
    const header = c.req.header("authorization") ?? "";
    // EventSource cannot set headers, so the SSE stream is the one place a token
    // may ride the query string. Scoped to that path only, and to a real access
    // token: a URL is logged and referred in ways a header is not, so this is a
    // deliberate exception rather than a general fallback.
    const queryToken = c.req.path === "/live" ? (c.req.query("access_token") ?? "") : "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : queryToken;

    if (bearer) {
        // 1. Shared static secret. Rejected outright on a locked deployment.
        if (env.staticApiKey && timingSafeMatch(header, `Bearer ${env.staticApiKey}`)) {
            if (env.prodLocked) return null;
            return { type: "external", userId: env.ownerUserId, via: "static", label: STATIC_KEY_LABEL };
        }

        // 2. Per-machine key row.
        const result = await lookupApiKey(bearer);
        if (result.status === "match") {
            return { type: "external", userId: env.ownerUserId, via: "apikey", label: result.label, keyId: result.id };
        }
        if (result.status === "prod_locked") return null;

        // 3. Access JWT from the web app or the native app.
        const claims = await verifyAccessToken(bearer);
        if (claims) {
            const isOwner = !!env.ownerEmail && claims.email.toLowerCase() === env.ownerEmail;
            return {
                type: isOwner ? "owner" : "user",
                userId: isOwner ? env.ownerUserId || claims.sub : claims.sub,
                via: "jwt",
            };
        }
    }

    // 4. LAN convenience, only when no credential resolved.
    if (!bearer && lanTrusted(c)) {
        return { type: "owner", userId: env.ownerUserId, via: "local" };
    }

    return null;
}
