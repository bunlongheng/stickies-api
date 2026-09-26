/**
 * /integrations - the trigger/action config rows automations read.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { query, queryOne, execute } from "../db.ts";
import { requireAuth } from "../auth/middleware.ts";

interface Integration {
    id: string;
    trigger: string | null;
    condition: unknown;
    type: string;
    config: unknown;
    name: string;
}

async function listIntegrations(c: Context): Promise<Response> {
    const rows = await query<Integration>(
        `SELECT id, trigger, condition, type, config, name FROM integrations WHERE active = true`
    );
    return c.json(rows);
}

async function createIntegration(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const type = typeof body.type === "string" ? body.type.trim() : "";
    if (!type) return c.json({ error: "type required" }, 400);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : type;

    const now = new Date().toISOString();
    const row = await queryOne<Integration>(
        `INSERT INTO integrations (type, name, trigger, condition, config, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, trigger, condition, type, config, name`,
        [type, name, body.trigger ?? null, JSON.stringify(body.condition ?? {}), JSON.stringify(body.config ?? {}), true, now, now]
    );
    return c.json(row, 201);
}

const INTEGRATION_PATCH_ALLOWED = ["type", "name", "trigger", "condition", "config", "active"] as const;

async function patchIntegration(c: Context): Promise<Response> {
    const id = c.req.param("id");
    // The original Next.js route called req.json() with no try/catch and 500'd
    // on a malformed body. Wrapped here to match the automations PATCH.
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const key of INTEGRATION_PATCH_ALLOWED) {
        if (key in body) {
            const val = body[key];
            setClauses.push(`${key} = $${idx++}`);
            values.push(typeof val === "object" && val !== null ? JSON.stringify(val) : val);
        }
    }
    setClauses.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(id);

    await execute(`UPDATE integrations SET ${setClauses.join(", ")} WHERE id = $${idx}`, values);
    return c.json({ ok: true });
}

async function deleteIntegration(c: Context): Promise<Response> {
    const id = c.req.param("id");
    await execute(`DELETE FROM integrations WHERE id = $1`, [id]);
    return c.json({ ok: true });
}

export const integrations = new Hono()
    .use("*", requireAuth)
    .get("/integrations", listIntegrations)
    .post("/integrations", createIntegration)
    .patch("/integrations/:id", patchIntegration)
    .delete("/integrations/:id", deleteIntegration);
