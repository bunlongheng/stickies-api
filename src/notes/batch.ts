/**
 * Batch create, up to 500 items in 1 request.
 *
 * Notes are buffered and flushed as ONE multi-row INSERT. Per-item statements
 * meant a 20-note batch paid 20 sequential round trips to a remote Postgres.
 * One bad row would fail the whole statement, so a per-row fallback keeps the
 * old behavior of each item succeeding or failing on its own. Folders stay
 * sequential: each needs its own duplicate check, and a later folder can
 * reference an earlier one by name.
 */
import { query, queryOne } from "../db.ts";
import { palette12 } from "../lib/colors.ts";
import { stripEmoji } from "../lib/note-format.ts";
import { isReservedFolderName, remapReservedFolderPath } from "../lib/reserved-folders.ts";
import { TABLE, getNextOrder, detectType, VALID_TYPES } from "./helpers.ts";
import type { LiveEvent } from "../realtime/sse.ts";

export const BATCH_LIMIT = 500;

export type BatchItem = Record<string, unknown>;
type Result = { type: string; data: Record<string, unknown> | null; error?: string };
type Attribution = { createdByKey: string | null; createdByMachine: string | null };

/** `[["note",title,content,folder,color], ["folder",name,color,parent]]` */
export function expandCompactArray(rows: unknown[][]): BatchItem[] {
    return rows.map((row) => {
        const [kind, ...rest] = row as [string, ...unknown[]];
        if (kind === "folder") return { type: "folder", name: rest[0], color: rest[1], parent_folder: rest[2] };
        return {
            type: "note", title: rest[0], content: rest[1] ?? "",
            folder_name: String(rest[2] ?? "CLAUDE").trim() || "CLAUDE", color: rest[3],
        };
    });
}

export async function runBatch(
    items: BatchItem[], userId: string, isExternal: boolean, attr: Attribution,
    emit: (event: LiveEvent, payload: unknown) => void
): Promise<{ results: Result[]; failed: number }> {
    const now = new Date().toISOString();

    // Load the colour distribution once, then keep it current in memory so a
    // 200-note batch still spreads evenly without 200 COUNT queries.
    const used = await query<{ folder_color: string }>(
        `SELECT folder_color FROM ${TABLE} WHERE is_folder = false AND user_id = $1`, [userId]
    );
    const counts = new Map<string, number>(palette12.map((c) => [c, 0]));
    for (const r of used) {
        const c = String(r.folder_color ?? "").toUpperCase();
        if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const pickColor = (raw?: unknown): string => {
        const c = String(raw ?? "").trim().toUpperCase();
        const chosen = /^#[0-9A-F]{6}$/.test(c)
            ? c
            : palette12.reduce((a, b) => (counts.get(b)! < counts.get(a)! ? b : a), palette12[0]!);
        counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
        return chosen;
    };

    let nextOrder = await getNextOrder(userId, false);
    const results: Result[] = [];
    const pending: { slot: number; order: number; values: unknown[] }[] = [];
    const extra = [attr.createdByKey, attr.createdByMachine].filter((v): v is string => v !== null);

    for (const item of items) {
        const slot = results.length;
        const kind = String(item.type ?? "note");
        try {
            if (kind === "folder") {
                const name = String(item.name ?? "").trim();
                if (!name) { results.push({ type: "folder", data: null, error: "name required" }); continue; }
                if (isReservedFolderName(name)) {
                    results.push({ type: "folder", data: null, error: `reserved_name: "Today"/"Yesterday" are virtual views, not folders` });
                    continue;
                }
                // External callers may not create root folders.
                const parent = String(item.parent_folder ?? "").trim() || (isExternal ? "CLAUDE" : null);
                const dup = await queryOne<{ id: string }>(
                    `SELECT id FROM ${TABLE} WHERE is_folder = true AND folder_name = $1
                     AND COALESCE(parent_folder_name, '') = $2 AND user_id = $3`,
                    [name, parent ?? "", userId]
                );
                if (dup) { results.push({ type: "folder", data: dup, error: "already exists" }); continue; }
                const row = await queryOne<Record<string, unknown>>(
                    `INSERT INTO ${TABLE} (is_folder, folder_name, title, content, folder_color, parent_folder_name, "order", created_at, updated_at, user_id)
                     VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                    [name, name, String(item.icon ?? "").trim(), pickColor(item.color), parent, nextOrder++, now, now, userId]
                );
                results.push({ type: "folder", data: row });
                continue;
            }

            const title = stripEmoji(String(item.title ?? "").trim());
            if (!title) { results.push({ type: "note", data: null, error: "title required" }); continue; }
            const content = String(item.content ?? "").trim();
            if (!content) { results.push({ type: "note", data: null, error: "content required" }); continue; }
            const folderRaw = "folder" in item ? String(item.folder ?? "").trim() : "CLAUDE";
            if (!folderRaw) { results.push({ type: "note", data: null, error: "folder cannot be empty" }); continue; }
            const folder = remapReservedFolderPath(folderRaw);
            const noteType = typeof item.type === "string" && VALID_TYPES.has(item.type) ? item.type : detectType(content, title);
            const order = nextOrder++;
            pending.push({ slot, order, values: [title, content, folder, noteType, pickColor(item.color), order, now, now, userId, ...extra] });
            results.push({ type: "note", data: null });
        } catch (err) {
            results.push({ type: kind, data: null, error: err instanceof Error ? err.message : "unknown error" });
        }
    }

    if (pending.length > 0) {
        const cols = `is_folder, title, content, folder_name, type, folder_color, "order", created_at, updated_at, user_id`
            + (attr.createdByKey ? `, created_by_key` : ``)
            + (attr.createdByMachine ? `, created_by_machine` : ``);
        const perRow = pending[0]!.values.length;
        const valuesSql = pending
            .map((_, r) => `(false, ${Array.from({ length: perRow }, (_, i) => `$${r * perRow + i + 1}`).join(", ")})`)
            .join(", ");
        try {
            const rows = await query<Record<string, unknown>>(
                `INSERT INTO ${TABLE} (${cols}) VALUES ${valuesSql} RETURNING *`,
                pending.flatMap((n) => n.values)
            );
            // RETURNING preserves VALUES order, so position is the primary mapping.
            // "order" is unique per row in this batch and is the fallback.
            const byOrder = new Map(rows.map((r) => [Number(r.order), r]));
            pending.forEach((n, i) => {
                const row = (rows.length === pending.length ? rows[i] : byOrder.get(n.order)) ?? null;
                results[n.slot] = row ? { type: "note", data: row } : { type: "note", data: null, error: "insert returned no row" };
            });
        } catch (err) {
            console.error("[batch] multi-row insert failed, falling back per row:", err instanceof Error ? err.message : err);
            const ph = Array.from({ length: perRow }, (_, i) => `$${i + 1}`).join(", ");
            for (const n of pending) {
                try {
                    const row = await queryOne<Record<string, unknown>>(
                        `INSERT INTO ${TABLE} (${cols}) VALUES (false, ${ph}) RETURNING *`, n.values
                    );
                    results[n.slot] = { type: "note", data: row };
                } catch (e) {
                    results[n.slot] = { type: "note", data: null, error: e instanceof Error ? e.message : "unknown error" };
                }
            }
        }
    }

    for (const r of results) if (r.data && !r.error) emit("note-created", r.data);
    return { results, failed: results.filter((r) => r.error).length };
}
