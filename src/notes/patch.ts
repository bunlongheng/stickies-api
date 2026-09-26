/**
 * PATCH /notes - 6 body shapes on 1 path.
 *
 * Two guards run on every path that touches a note body:
 *  - PATCH_ALLOWED_COLS, because the JSON keys become SQL identifiers. An
 *    unfiltered key is both a mass-assignment (user_id, created_by_key,
 *    lock_password_hash) and an injection vector via a `"`-bearing key.
 *  - frozen, the owner's write-protect. A frozen note is 423 unless the change
 *    is releasing the freeze or a sharing control.
 */
import type { Context } from "hono";
import { query, queryOne, execute } from "../db.ts";
import { caller } from "../auth/middleware.ts";
import { broadcast } from "../realtime/sse.ts";
import { livePayload } from "../lib/live-payload.ts";
import { hashLockPassword } from "../lib/lock-password.ts";
import { isReservedFolderName } from "../lib/reserved-folders.ts";
import { TABLE, withUser, PATCH_ALLOWED_COLS } from "./helpers.ts";
import { announceRequest } from "./announce.ts";

const RESERVED_MSG = `"Today"/"Yesterday" are reserved virtual views`;

async function isFrozen(id: string, userId: string): Promise<boolean> {
    const { sql, params } = withUser(`SELECT frozen FROM ${TABLE} WHERE id = $1`, [id], userId);
    return (await queryOne<{ frozen: boolean }>(sql, params))?.frozen === true;
}

/** `doc` is JSONB: node-pg stringifies a raw object to "[object Object]". */
const bind = (k: string, v: unknown): unknown =>
    k === "doc" && v !== null && typeof v === "object" ? JSON.stringify(v) : v;

export async function patchNote(c: Context): Promise<Response> {
    const who = caller(c);
    const { userId } = who;
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }

    announceRequest(c, who, body);
    const now = new Date().toISOString();

    // 1. Pinned folders.
    if (body.pinned_folders !== undefined) {
        const folders = Array.isArray(body.pinned_folders) ? body.pinned_folders.map(String) : [];
        await execute(
            `INSERT INTO user_preferences (user_id, pinned_folders, updated_at) VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET pinned_folders = $2, updated_at = $3`,
            [userId, folders, now]
        );
        return c.json({ ok: true, pinned_folders: folders });
    }

    // 2. Rename one note.
    if (body.rename_note) {
        const { id, title } = body.rename_note as { id?: string; title?: string };
        if (!id?.trim() || !title?.trim()) return c.json({ error: "rename_note requires id and title" }, 400);
        if (await isFrozen(id.trim(), userId)) return c.json({ error: "Note is locked", frozen: true }, 423);
        const { sql, params } = withUser(
            `UPDATE ${TABLE} SET title = $1, updated_at = $2 WHERE id = $3`, [title.trim(), now, id.trim()], userId
        );
        return c.json({ ok: true, note: await queryOne(`${sql} RETURNING *`, params) });
    }

    // 3. Rename a folder: the folder row and every note filed under it.
    if (body.rename_folder) {
        const { from, to } = body.rename_folder as { from?: string; to?: string };
        if (!from?.trim() || !to?.trim()) return c.json({ error: "rename_folder requires from and to" }, 400);
        const target = to.trim();
        if (isReservedFolderName(target)) return c.json({ error: RESERVED_MSG }, 400);
        const a = withUser(
            `UPDATE ${TABLE} SET folder_name = $1, title = $2, updated_at = $3 WHERE is_folder = true AND folder_name = $4`,
            [target, target, now, from.trim()], userId
        );
        await execute(a.sql, a.params);
        const b = withUser(
            `UPDATE ${TABLE} SET folder_name = $1, updated_at = $2 WHERE is_folder = false AND folder_name = $3`,
            [target, now, from.trim()], userId
        );
        await execute(b.sql, b.params);
        return c.json({ ok: true, renamed: { from, to: target } });
    }

    // 4. Merge a folder into another, then drop the empty folder row.
    if (body.merge_folder) {
        const { from, to } = body.merge_folder as { from?: string; to?: string };
        if (!from?.trim() || !to?.trim()) return c.json({ error: "merge_folder requires from and to" }, 400);
        if (isReservedFolderName(to.trim())) return c.json({ error: RESERVED_MSG }, 400);
        const move = withUser(
            `UPDATE ${TABLE} SET folder_name = $1, updated_at = $2 WHERE is_folder = false AND folder_name = $3`,
            [to.trim(), now, from.trim()], userId
        );
        const moved = await query<{ id: string }>(`${move.sql} RETURNING id`, move.params);
        const drop = withUser(`DELETE FROM ${TABLE} WHERE is_folder = true AND folder_name = $1`, [from.trim()], userId);
        await execute(drop.sql, drop.params);
        return c.json({ ok: true, merged: { from, to: to.trim(), moved: moved.length } });
    }

    // 5. Batch field updates. Frozen rows are skipped, never silently overwritten.
    if (Array.isArray(body.updates)) {
        const updates = body.updates as { id: string; [k: string]: unknown }[];
        const ids = updates.map((u) => u.id).filter(Boolean);
        const lockedIds = new Set<string>();
        if (ids.length) {
            const lk = withUser(
                `SELECT id FROM ${TABLE} WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(",")}) AND frozen = true`,
                ids, userId
            );
            for (const r of await query<{ id: string }>(lk.sql, lk.params)) lockedIds.add(String(r.id));
        }
        await Promise.all(updates.filter((u) => !lockedIds.has(String(u.id))).map(({ id, ...fields }) => {
            const allowed = Object.entries(fields).filter(([k]) => PATCH_ALLOWED_COLS.has(k));
            const entries = [...allowed, ["updated_at", now] as [string, unknown]];
            const vals: unknown[] = entries.map(([k, v]) => bind(k, v));
            vals.push(id);
            const { sql, params } = withUser(
                `UPDATE ${TABLE} SET ${entries.map(([k], i) => `"${k}" = $${i + 1}`).join(", ")} WHERE id = $${vals.length}`,
                vals, userId
            );
            return execute(sql, params);
        }));
        return c.json({ ok: true, locked_skipped: [...lockedIds] });
    }

    // 6. One note by id.
    const { id, ...fields } = body;
    if (!id || typeof id !== "string") return c.json({ error: "id is required" }, 400);

    // Sharing is OWNER-only. A leaked key must never be able to publish a private
    // note or rewrite its passcode.
    if (who.type === "external") {
        for (const k of ["is_public", "locked", "lock_password", "lock_password_hash"]) delete fields[k];
    }

    if (await isFrozen(id, userId)) {
        // Write-protect blocks CONTENT edits, not sharing controls: a frozen note
        // must still be publishable and passcode-gateable.
        const FROZEN_ALLOWED = new Set(["frozen", "is_public", "locked", "lock_password"]);
        if (!Object.keys(fields).every((k) => FROZEN_ALLOWED.has(k))) {
            return c.json({ error: "Note is locked", frozen: true }, 423);
        }
    }

    // lock_password_hash is server-managed and never client-writable. Unlocking
    // clears it so a later re-lock starts fresh with no stale password lingering.
    if (typeof fields.lock_password === "string") {
        const plain = fields.lock_password.trim();
        fields.lock_password_hash = plain ? await hashLockPassword(plain) : null;
        delete fields.lock_password;
    }
    if (fields.locked === false) fields.lock_password_hash = null;

    const allowed = Object.entries(fields).filter(([k]) => PATCH_ALLOWED_COLS.has(k));
    if (allowed.length === 0) return c.json({ note: { id } });
    const entries = [...allowed, ["updated_at", now] as [string, unknown]];
    const vals: unknown[] = entries.map(([k, v]) => bind(k, v));
    vals.push(id);
    const { sql, params } = withUser(
        `UPDATE ${TABLE} SET ${entries.map(([k], i) => `"${k}" = $${i + 1}`).join(", ")} WHERE id = $${vals.length}`,
        vals, userId
    );

    let note: Record<string, unknown> | null;
    try {
        note = await queryOne(`${sql} RETURNING *`, params);
    } catch (err) {
        console.error("[patch] db error:", err instanceof Error ? err.message : err);
        return c.json({ error: err instanceof Error ? err.message : "db error" }, 500);
    }
    // A null RETURNING can come back even though the UPDATE ran. Treat it as
    // success so the client never shows a false "Save Failed".
    broadcast(userId, "note-updated", livePayload(note ?? { id }));
    return c.json({ note: note ?? { id } });
}
