/**
 * GET /notes - 13 read modes on 1 path, matching the Next.js route exactly so
 * stickies-web needs no query changes. Selected by query param, in this order.
 */
import type { Context } from "hono";
import { query, queryOne, execute } from "../db.ts";
import { env } from "../env.ts";
import { caller } from "../auth/middleware.ts";
import { TABLE, withUser, LIST_COLS, RECENT_COLS, FULL_COLS } from "./helpers.ts";
import { skillScopedSearch } from "./search.ts";

/**
 * Permanently delete TRASH notes older than 7 days. Throttled to once an hour
 * per user and fire-and-forget, so a read never waits on this write.
 */
const trashSweptAt = new Map<string, number>();
const TRASH_SWEEP_MS = 60 * 60 * 1000;

function sweepTrash(userId: string): void {
    const now = Date.now();
    if (now - (trashSweptAt.get(userId) ?? 0) <= TRASH_SWEEP_MS) return;
    trashSweptAt.set(userId, now);
    execute(
        `DELETE FROM ${TABLE} WHERE user_id = $1 AND folder_name = 'TRASH'
         AND trashed_at IS NOT NULL AND trashed_at < NOW() - INTERVAL '7 days'`,
        [userId]
    ).catch(() => {});
}

const int = (v: string | undefined, dflt: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, parseInt(v ?? String(dflt)) || dflt));

export async function getNotes(c: Context): Promise<Response> {
    const { type, userId } = caller(c);
    const q = c.req.query();
    sweepTrash(userId);

    // 1. Pinned folders.
    if (q.prefs === "1") {
        const row = await queryOne<{ pinned_folders: string[] }>(
            `SELECT pinned_folders FROM user_preferences WHERE user_id = $1`, [userId]
        );
        return c.json({ pinned_folders: row?.pinned_folders ?? [] });
    }

    // 2. Reveal the shared key for the import guide. A keyed caller is refused so
    //    a leaked scoped key can never read the master key.
    if (q.apikey === "1") {
        if (type !== "owner") return c.json({ error: "Forbidden" }, 403, { "Cache-Control": "no-store" });
        return c.json({ key: env.staticApiKey }, 200, { "Cache-Control": "no-store" });
    }

    // 3. Single note by folder + title, used for the routed BHENG pages.
    if (q.route?.trim()) {
        const { sql, params } = withUser(
            `SELECT ${FULL_COLS} FROM ${TABLE} WHERE is_folder = false AND folder_name = $1 AND title = $2`,
            [q.folder ?? "BHENG", q.route.trim()], userId
        );
        return c.json({ sticky: await queryOne(`${sql} LIMIT 1`, params) });
    }

    // 4. Folders only.
    if (q.folders === "1") {
        const { sql, params } = withUser(
            `SELECT id, folder_name, folder_color, parent_folder_name, "order", updated_at, content
             FROM ${TABLE} WHERE is_folder = true`, [], userId
        );
        return c.json({ folders: await query(`${sql} ORDER BY "order" ASC LIMIT 2000`, params) });
    }

    // 5. Today. `days` widens the window in 24h steps for the Load-more button.
    if (q.recent === "today") {
        const days = int(q.days, 1, 1, 30);
        const { sql, params } = withUser(
            `SELECT ${RECENT_COLS} FROM ${TABLE} WHERE is_folder = false AND trashed_at IS NULL
             AND created_at >= NOW() - ($${1} * INTERVAL '24 hours')`, [days], userId
        );
        return c.json({ notes: await query(`${sql} ORDER BY updated_at DESC LIMIT 500`, params), days });
    }

    // 6. All. Ordered by creation, not edit: editing a note must not jump it to the top.
    if (q.recent === "all") {
        const limit = int(q.limit, 20, 1, 100);
        const offset = Math.max(0, parseInt(q.offset ?? "0") || 0);
        const { sql, params } = withUser(
            `SELECT ${RECENT_COLS}, COUNT(*) OVER() AS _total FROM ${TABLE}
             WHERE is_folder = false AND trashed_at IS NULL`, [], userId
        );
        params.push(limit, offset);
        const rows = await query<Record<string, unknown>>(
            `${sql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
        );
        return c.json({ notes: rows.map(({ _total, ...rest }) => rest), total: Number(rows[0]?._total ?? 0) });
    }

    // 7. Counts per folder, plus the Today card's count computed server-side.
    if (q.counts === "1") {
        const rows = await query<{ folder_name: string; folder_id: string | null; cnt: string; latest: string }>(
            `SELECT folder_name, folder_id::text AS folder_id, COUNT(*) AS cnt, MAX(updated_at) AS latest
             FROM ${TABLE} WHERE is_folder = false AND user_id = $1
             AND (trashed_at IS NULL OR folder_name = 'TRASH') GROUP BY folder_name, folder_id`,
            [userId]
        );
        const counts: Record<string, number> = {};
        const countsByFolderId: Record<string, number> = {};
        const latestByFolderId: Record<string, string> = {};
        let total = 0;
        for (const row of rows) {
            const n = Number(row.cnt ?? 0);
            if (row.folder_name) counts[row.folder_name] = (counts[row.folder_name] ?? 0) + n;
            if (row.folder_id) {
                const id = String(row.folder_id);
                countsByFolderId[id] = (countsByFolderId[id] ?? 0) + n;
                const ts = String(row.latest ?? "");
                if (!latestByFolderId[id] || ts > latestByFolderId[id]!) latestByFolderId[id] = ts;
            }
            total += n;
        }
        const todayRow = await queryOne<{ n: string }>(
            `SELECT COUNT(*) AS n FROM ${TABLE} WHERE is_folder = false AND user_id = $1
             AND trashed_at IS NULL AND created_at >= NOW() - INTERVAL '24 hours'`, [userId]
        );
        return c.json({ counts, countsByFolderId, latestByFolderId, total, todayCount: Number(todayRow?.n ?? 0) });
    }

    // 8 + 9. One folder, either a delta since a timestamp or a full page.
    if (q.folder) {
        if (q.since) {
            const since = new Date(q.since);
            if (!isNaN(since.getTime())) {
                const { sql, params } = withUser(
                    `SELECT ${LIST_COLS} FROM ${TABLE} WHERE is_folder = false AND folder_name = $1 AND updated_at > $2`,
                    [q.folder, since.toISOString()], userId
                );
                const notes = await query(`${sql} ORDER BY updated_at DESC`, params);
                return c.json({ notes, delta: true, syncedAt: new Date().toISOString() });
            }
        }
        const { sql: where, params } = withUser(`WHERE is_folder = false AND folder_name = $1`, [q.folder], userId);
        const limit = parseInt(q.limit ?? "0");
        let page = "";
        if (limit > 0) {
            params.push(limit, parseInt(q.offset ?? "0") || 0);
            page = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }
        const rows = await query<Record<string, unknown>>(
            `SELECT ${LIST_COLS}, COUNT(*) OVER() AS _total FROM ${TABLE} ${where} ORDER BY updated_at DESC ${page}`,
            params
        );
        return c.json({
            notes: rows.map(({ _total, ...rest }) => rest),
            total: Number(rows[0]?._total ?? 0),
            syncedAt: new Date().toISOString(),
        });
    }

    // 10. Search, with the skill-scoped path handled first.
    if (q.q?.trim()) return skillScopedSearch(c, q.q.trim(), userId);

    // 11. One note by id, full row.
    if (q.id?.trim()) {
        const { sql, params } = withUser(
            `SELECT ${FULL_COLS} FROM ${TABLE} WHERE is_folder = false AND id = $1`, [q.id.trim()], userId
        );
        return c.json({ note: await queryOne(`${sql} LIMIT 1`, params) });
    }

    // 12. Export, full rows.
    if (q.export === "1") {
        const { sql, params } = withUser(`SELECT ${FULL_COLS} FROM ${TABLE} WHERE is_folder = false`, [], userId);
        const notes = await query(`${sql} ORDER BY updated_at DESC LIMIT 500`, params);
        return c.json({ notes, total: notes.length });
    }

    // 13. Default board list.
    const { sql, params } = withUser(`SELECT ${LIST_COLS} FROM ${TABLE} WHERE is_folder = false`, [], userId);
    return c.json({ notes: await query(`${sql} ORDER BY "order" ASC LIMIT 500`, params) });
}
