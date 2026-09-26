/**
 * /backup - full-table dump of the owner's notes (SQL or JSON) plus a manual
 * GitHub Actions trigger for the scheduled backup workflow.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { query } from "../db.ts";
import { env } from "../env.ts";
import { requireAuth } from "../auth/middleware.ts";

async function getBackup(c: Context): Promise<Response> {
    const format = c.req.query("format");
    const rows = await query(`SELECT * FROM "stickies" WHERE user_id = $1 ORDER BY "order" ASC`, [env.ownerUserId]);
    const now = new Date().toISOString();

    if (format === "json") {
        const filename = `stickies-backup-${now.slice(0, 10)}.json`;
        return new Response(JSON.stringify(rows, null, 2), {
            headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }

    const escape = (v: unknown): string => {
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
        if (typeof v === "number") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
    };

    const lines: string[] = [
        `-- stickies backup - ${now}`,
        `-- ${rows.length} rows`,
        ``,
        `TRUNCATE TABLE stickies RESTART IDENTITY CASCADE;`,
        ``,
    ];
    for (const row of rows) {
        const cols = Object.keys(row).join(", ");
        const vals = Object.values(row).map(escape).join(", ");
        lines.push(`INSERT INTO stickies (${cols}) VALUES (${vals});`);
    }

    const sql = lines.join("\n") + "\n";
    const filename = `stickies-backup-${now.slice(0, 10)}.sql`;
    return new Response(sql, {
        headers: {
            "Content-Type": "application/sql",
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
}

async function triggerBackup(c: Context): Promise<Response> {
    const token = env.githubBackupToken;
    if (!token) return c.json({ error: "GITHUB_BACKUP_TOKEN not configured" }, 500);

    const res = await fetch(
        "https://api.github.com/repos/bunlongheng/stickies-backup/actions/workflows/backup.yml/dispatches",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref: "main", inputs: { prefix: "manual" } }),
        }
    );

    if (res.status === 204) return c.json({ ok: true, message: "Backup triggered on GitHub" });

    const body: unknown = await res.json().catch(() => ({}));
    console.error("[backup POST]", res.status, body);
    return c.json({ error: "GitHub dispatch failed", detail: body }, 500);
}

export const backup = new Hono()
    .use("*", requireAuth)
    .get("/backup", getBackup)
    .post("/backup", triggerBackup);
