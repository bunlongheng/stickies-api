/**
 * DELETE /notes. No API key can reach this: deletion is owner-browser-only, so
 * a leaked key can never destroy notes. Enforced by forbidExternal on the route.
 */
import type { Context } from "hono";
import { queryOne, execute } from "../db.ts";
import { caller } from "../auth/middleware.ts";
import { broadcast } from "../realtime/sse.ts";
import { TABLE, withUser } from "./helpers.ts";
import { announceRequest } from "./announce.ts";

export async function deleteNote(c: Context): Promise<Response> {
    const who = caller(c);
    const { userId } = who;
    announceRequest(c, who);

    const id = c.req.query("id")?.trim();
    const folderName = c.req.query("folder_name")?.trim();

    if (id) {
        // A frozen note cannot be deleted either. That makes the lock a true
        // write-protect, not just an edit guard.
        const sel = withUser(`SELECT frozen FROM ${TABLE} WHERE id = $1`, [id], userId);
        if ((await queryOne<{ frozen: boolean }>(sel.sql, sel.params))?.frozen) {
            return c.json({ error: "Note is locked", frozen: true }, 423);
        }
        const { sql, params } = withUser(`DELETE FROM ${TABLE} WHERE id = $1`, [id], userId);
        await execute(sql, params);
        broadcast(userId, "note-deleted", { id });
        return c.json({ ok: true, deleted_note: id });
    }

    if (!folderName) return c.json({ error: "id or folder_name is required" }, 400);

    // Deleting a folder row by name also wipes every note under it, so refuse
    // while it still holds notes. TRASH is exempt: emptying it is the point.
    if (folderName !== "TRASH") {
        const guard = withUser(
            `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE folder_name = $1 AND is_folder = false AND trashed_at IS NULL`,
            [folderName], userId
        );
        const n = (await queryOne<{ n: number }>(guard.sql, guard.params))?.n ?? 0;
        if (n > 0) {
            return c.json({
                error: `Folder "${folderName}" still has ${n} note${n === 1 ? "" : "s"}. Move or delete them first.`,
                code: "folder_not_empty",
                note_count: n,
            }, 409);
        }
    }

    // For TRASH, delete the notes inside but never the folder row itself.
    const del = folderName === "TRASH"
        ? withUser(`DELETE FROM ${TABLE} WHERE folder_name = $1 AND is_folder = false`, [folderName], userId)
        : withUser(`DELETE FROM ${TABLE} WHERE folder_name = $1`, [folderName], userId);
    await execute(del.sql, del.params);
    broadcast(userId, "note-deleted", { folder_name: folderName });
    return c.json({ ok: true, deleted_folder: folderName });
}
