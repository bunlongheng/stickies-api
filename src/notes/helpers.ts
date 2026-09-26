/**
 * Shared query pieces for the notes routes. Ported from the Next.js route so
 * the SQL, the column whitelists and the fuzzy matcher behave identically.
 */
import { query, queryOne } from "../db.ts";
import { palette12 } from "../lib/colors.ts";

export const TABLE = `"stickies"`;

/** Parameterized user isolation. userId is NEVER interpolated into SQL. */
export function withUser(sql: string, params: unknown[], userId?: string): { sql: string; params: unknown[] } {
    if (!userId) return { sql, params: [...params] };
    return { sql: `${sql} AND user_id = $${params.length + 1}`, params: [...params, userId] };
}

export const RAW_INSERT_ALLOWED_COLS = new Set([
    "title", "content", "folder_name", "folder_color", "is_folder", "type",
    "order", "created_at", "updated_at", "parent_folder_name", "folder_id", "list_mode",
    "format", "doc", "created_by_key", "created_by_machine",
]);

export const PATCH_ALLOWED_COLS = new Set([
    "title", "content", "folder_name", "folder_color", "is_folder", "type",
    "order", "updated_at", "parent_folder_name", "folder_id", "list_mode", "tags",
    "trashed_at", "is_public", "icon", "format", "doc",
    // Share visibility: passcode-gated Private share plus its hash.
    "locked", "lock_password_hash",
    // Write-protect: a frozen note cannot be modified or deleted.
    "frozen",
]);

/** Checklist progress, computed in SQL. `[x]` counts 1, `[/]` counts 0.5. */
const taskCounts = (() => {
    const isList = `(type = 'checklist' OR list_mode = true) AND content IS NOT NULL AND length(content) > 0`;
    const lines = `regexp_split_to_table(content, E'\\n') AS line`;
    const real = `TRIM(line) <> '' AND TRIM(line) !~ '^[-=*#~_.]{2,}$'`;
    return `
        CASE WHEN ${isList} THEN (SELECT COUNT(*)::int FROM ${lines} WHERE ${real}) ELSE 0 END AS task_count,
        CASE WHEN ${isList} THEN COALESCE((SELECT SUM(CASE WHEN TRIM(line) ~* '^\\[x\\]' THEN 1.0 WHEN TRIM(line) ~ '^\\[/\\]' THEN 0.5 ELSE 0 END)::float FROM ${lines}), 0) ELSE 0 END AS task_done_count,
        CASE WHEN ${isList} THEN (SELECT COUNT(*)::int FROM ${lines} WHERE ${real} AND TRIM(line) !~* '^\\[x\\]') ELSE 0 END AS task_remaining_count`;
})();

const BASE_COLS = `id, title, folder_name, folder_color, folder_id, parent_folder_name, "order",
    updated_at, created_at, type, is_folder, is_public, trashed_at, icon, list_mode, locked, frozen,
    created_by_key, created_by_machine`;

/**
 * Full-row reads. `SELECT *` used to be fine until `lock_password_hash` was
 * added: that column is the scrypt hash of a note's share passcode, and a
 * SELECT * handed it to every authenticated caller, keyed agents included. It
 * is server-managed, no client has ever read it, so it is excluded here.
 */
export const FULL_COLS = `id, title, content, folder_name, folder_color, folder_id, parent_folder_name,
    parent_folder_id, "order", updated_at, created_at, type, is_folder, is_public, trashed_at, icon,
    list_mode, locked, frozen, created_by_key, created_by_machine, format, doc, tags, user_id`;

/** Tile columns: everything the grid renders, minus the note body. */
export const LIST_COLS = `${BASE_COLS}, format, ${taskCounts}`;
/** Today and All: same tiles without the checklist rollup. */
export const RECENT_COLS = BASE_COLS;
/** Search results: no list_mode / attribution, they are not rendered as tiles. */
export const SEARCH_COLS = `id, title, folder_name, folder_color, folder_id, parent_folder_name, "order",
    updated_at, created_at, type, is_folder, is_public, trashed_at, icon, locked, frozen`;

/** Least-used palette colour, so a board spreads evenly instead of going all red. */
export async function pickLeastUsedColor(userId: string, rawColor: string | undefined, isFolder: boolean): Promise<string> {
    const c = String(rawColor ?? "").trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(c)) return c;
    const rows = await query<{ folder_color: string; cnt: string }>(
        `SELECT UPPER(folder_color) AS folder_color, COUNT(*) AS cnt FROM ${TABLE}
         WHERE is_folder = $1 AND user_id = $2 GROUP BY UPPER(folder_color)`,
        [isFolder, userId]
    );
    const counts = new Map<string, number>(palette12.map((p) => [p, 0]));
    for (const r of rows) if (counts.has(r.folder_color)) counts.set(r.folder_color, Number(r.cnt));
    return palette12.reduce((a, b) => (counts.get(b)! < counts.get(a)! ? b : a), palette12[0]!);
}

export async function getNextOrder(userId: string, isFolderOnly = false): Promise<number> {
    const row = await queryOne<{ order: number }>(
        `SELECT "order" FROM ${TABLE} WHERE is_folder = $1 AND user_id = $2 ORDER BY "order" DESC LIMIT 1`,
        [isFolderOnly, userId]
    );
    return typeof row?.order === "number" ? row.order + 1 : 0;
}

const normalize = (s: string): string => s.toLowerCase().replace(/[-_ ]/g, "");

/** 4 passes, most exact first: case-insensitive, normalized, prefix, substring. */
export function fuzzyMatchFolder<T extends { folder_name: string }>(
    folders: T[], input: string, parentFilter?: (f: T) => boolean
): T | undefined {
    const norm = normalize(input);
    const pool = parentFilter ? folders.filter(parentFilter) : folders;
    return pool.find((f) => f.folder_name.toLowerCase() === input.toLowerCase())
        ?? pool.find((f) => normalize(f.folder_name) === norm)
        ?? pool.find((f) => normalize(f.folder_name).startsWith(norm) || norm.startsWith(normalize(f.folder_name)))
        ?? pool.find((f) => normalize(f.folder_name).includes(norm) || norm.includes(normalize(f.folder_name)));
}

export const VALID_TYPES = new Set([
    "text", "html", "json", "javascript", "typescript", "python", "css", "sql", "bash", "checklist",
]);

const EXT_TYPES: Record<string, string> = {
    js: "javascript", ts: "typescript", py: "python", css: "css", sql: "sql",
    sh: "bash", bash: "bash", html: "html", htm: "html", json: "json",
};

export function detectType(content: string, title?: string): string {
    const t = content.trim();
    if (!t) return "text";
    if ((t.startsWith("{") || t.startsWith("[")) && (() => { try { JSON.parse(t); return true; } catch { return false; } })()) return "json";
    if (title) {
        const ext = title.split(".").pop()?.toLowerCase() ?? "";
        if (EXT_TYPES[ext]) return EXT_TYPES[ext];
    }
    if (/^\s*<!DOCTYPE\s+html/i.test(t) || /^\s*<html[\s>]/i.test(t)) return "html";
    if (/^\s*\[[ xX]?\]/m.test(t)) return "checklist";
    return "text";
}
