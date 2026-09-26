/**
 * /keys - owner-only API-key management (create / list / revoke).
 *
 * Management is OWNER-ONLY and must reject machine auth: a static or per-machine
 * API key can authenticate to post notes, but it must NOT be able to create or
 * revoke keys. requireOwnerPerson already 403s `via: 'apikey'` and `via: 'static'`,
 * so only `via: 'local'` (dev/LAN) or `via: 'jwt'` (browser owner) reach these
 * handlers.
 *
 * Keys are stored as sha-256 hashes; the plaintext is returned ONCE on create.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { query, queryOne, execute } from "../db.ts";
import { env } from "../env.ts";
import { requireAuth, requireOwnerPerson } from "../auth/middleware.ts";
import { generateApiKey } from "../lib/api-keys.ts";

async function listKeys(c: Context): Promise<Response> {
    const rows = await query<{
        id: string; label: string; key_prefix: string;
        created_at: string; last_used_at: string | null; revoked_at: string | null;
    }>(`SELECT id, label, key_prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC`);
    return c.json({ keys: rows });
}

async function createKey(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return c.json({ error: "label is required" }, 400);

    const { plaintext, hash, prefix } = generateApiKey();
    const row = await queryOne<{ id: string; label: string }>(
        `INSERT INTO api_keys (label, key_hash, key_prefix, user_id) VALUES ($1, $2, $3, $4) RETURNING id, label`,
        [label, hash, prefix, env.ownerUserId]
    );
    if (!row) return c.json({ error: "Database error" }, 500);

    // Plaintext is returned ONCE - it is never stored or shown again.
    return c.json({ id: row.id, label: row.label, key: plaintext, prefix }, 201);
}

async function revokeKey(c: Context): Promise<Response> {
    const id = c.req.query("id")?.trim();
    if (!id) return c.json({ error: "id is required" }, 400);

    const count = await execute(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
    if (count === 0) return c.json({ error: "Key not found" }, 404);
    return c.json({ ok: true, revoked: id });
}

export const keys = new Hono()
    .use("*", requireAuth, requireOwnerPerson)
    .get("/keys", listKeys)
    .post("/keys", createKey)
    .delete("/keys", revokeKey);
