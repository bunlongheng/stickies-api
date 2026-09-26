/**
 * /folder-icon - the folder emoji/icon, stored in the folder row's own `content` column.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { query, execute } from "../db.ts";
import { env } from "../env.ts";
import { requireAuth } from "../auth/middleware.ts";

async function getFolderIcons(c: Context): Promise<Response> {
    const rows = await query<{ folder_name: string; content: string }>(
        `SELECT folder_name, content FROM "stickies" WHERE is_folder = true AND user_id = $1`,
        [env.ownerUserId]
    );

    const icons: Record<string, string> = {};
    for (const row of rows) {
        if (row.folder_name && row.content && row.content.trim()) icons[row.folder_name] = row.content.trim();
    }
    return c.json({ icons });
}

async function patchFolderIcon(c: Context): Promise<Response> {
    let folderName = "";
    let icon = "";
    try {
        const body = await c.req.json();
        folderName = String(body.folderName ?? "").trim();
        icon = String(body.icon ?? "").trim();
    } catch {
        return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!folderName) return c.json({ error: "folderName required" }, 400);

    await execute(
        `UPDATE "stickies" SET content = $1, updated_at = $2 WHERE is_folder = true AND folder_name = $3 AND user_id = $4`,
        [icon, new Date().toISOString(), folderName, env.ownerUserId]
    );
    return c.json({ ok: true });
}

export const folderIcon = new Hono()
    .use("*", requireAuth)
    .get("/folder-icon", getFolderIcons)
    .patch("/folder-icon", patchFolderIcon);
