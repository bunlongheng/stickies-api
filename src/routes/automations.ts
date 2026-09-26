/**
 * /automations (CRUD for automation rules) and /automation-logs (their fire history).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { query, queryOne, execute } from "../db.ts";
import { requireAuth } from "../auth/middleware.ts";

interface Automation {
    id: string;
    name: string;
    trigger_type: string;
    trigger_integration_id: string | null;
    condition: unknown;
    action_type: string;
    action_integration_id: string | null;
    action_config: unknown;
    active: boolean;
    created_at: string;
    updated_at: string;
}

async function listAutomations(c: Context): Promise<Response> {
    const data = await query<Automation>(
        `SELECT id, name, trigger_type, trigger_integration_id, condition,
                action_type, action_integration_id, action_config, active,
                created_at, updated_at
         FROM automations
         ORDER BY created_at ASC`
    );

    // Attach last_fired: the most recent successful trigger per automation, or null.
    const ids = data.map((a) => a.id);
    const lastFired: Record<string, string> = {};
    if (ids.length > 0) {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        const logs = await query<{ automation_id: string; triggered_at: string }>(
            `SELECT automation_id, triggered_at
             FROM automation_logs
             WHERE automation_id IN (${placeholders}) AND result = 'ok'
             ORDER BY triggered_at DESC`,
            ids
        );
        for (const log of logs) {
            if (!(log.automation_id in lastFired)) lastFired[log.automation_id] = log.triggered_at;
        }
    }

    return c.json(data.map((a) => ({ ...a, last_fired: lastFired[a.id] ?? null })));
}

async function createAutomation(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const triggerType = typeof body.trigger_type === "string" ? body.trigger_type.trim() : "";
    const actionType = typeof body.action_type === "string" ? body.action_type.trim() : "";
    if (!name) return c.json({ error: "name required" }, 400);
    if (!triggerType) return c.json({ error: "trigger_type required" }, 400);
    if (!actionType) return c.json({ error: "action_type required" }, 400);

    const now = new Date().toISOString();
    const row = await queryOne<Automation>(
        `INSERT INTO automations (name, trigger_type, trigger_integration_id, condition,
                                  action_type, action_integration_id, action_config, active,
                                  created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
            name,
            triggerType,
            body.trigger_integration_id ?? null,
            JSON.stringify(body.condition ?? {}),
            actionType,
            body.action_integration_id ?? null,
            JSON.stringify(body.action_config ?? {}),
            true,
            now,
            now,
        ]
    );
    return c.json(row, 201);
}

const AUTOMATION_PATCH_ALLOWED = [
    "name", "trigger_type", "trigger_integration_id", "condition",
    "action_type", "action_integration_id", "action_config", "active",
] as const;

async function patchAutomation(c: Context): Promise<Response> {
    const id = c.req.param("id");
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const key of AUTOMATION_PATCH_ALLOWED) {
        if (key in body) {
            const val = (key === "condition" || key === "action_config") ? JSON.stringify(body[key] ?? {}) : body[key];
            setClauses.push(`${key} = $${idx++}`);
            values.push(val);
        }
    }
    setClauses.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(id);

    await execute(`UPDATE automations SET ${setClauses.join(", ")} WHERE id = $${idx}`, values);
    return c.json({ ok: true });
}

async function deleteAutomation(c: Context): Promise<Response> {
    const id = c.req.param("id");
    await execute(`DELETE FROM automations WHERE id = $1`, [id]);
    return c.json({ ok: true });
}

async function listAutomationLogs(c: Context): Promise<Response> {
    const automationId = c.req.query("automation_id");
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);

    let sql = `SELECT id, automation_id, automation_name, triggered_at, result, detail, via, trigger_payload
               FROM automation_logs`;
    const params: unknown[] = [];
    if (automationId) {
        sql += ` WHERE automation_id = $1`;
        params.push(automationId);
    }
    sql += ` ORDER BY triggered_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const data = await query(sql, params);
    return c.json(data);
}

export const automations = new Hono()
    .use("*", requireAuth)
    .get("/automations", listAutomations)
    .post("/automations", createAutomation)
    .patch("/automations/:id", patchAutomation)
    .delete("/automations/:id", deleteAutomation)
    .get("/automation-logs", listAutomationLogs);
