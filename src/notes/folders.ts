/**
 * Folder resolution for incoming notes.
 *
 * A caller may send "Jobs", "jobs", "job-search", or a path "CLAUDE/PM2026".
 * All of it resolves to one real folder row. Missing SUB-folders are created on
 * the way down; a missing ROOT is an error, because auto-creating roots is how
 * the board filled up with junk top-level folders.
 */
import { query, queryOne } from "../db.ts";
import { TABLE, fuzzyMatchFolder, getNextOrder } from "./helpers.ts";
import { palette12 } from "../lib/colors.ts";
import type { LiveEvent } from "../realtime/sse.ts";

type FolderRow = { id: string; folder_name: string; parent_folder_name: string | null };
export type Resolved = { folderId: string | null; folderName: string };
type Emit = (event: LiveEvent, payload: unknown) => void;

const loadFolders = (userId: string): Promise<FolderRow[]> =>
    query<FolderRow>(
        `SELECT id::text, folder_name, parent_folder_name FROM ${TABLE} WHERE is_folder = true AND user_id = $1`,
        [userId]
    );

/**
 * Non-browser callers (no `mozilla` in the UA) that name a simple folder we do
 * not recognise get nested under CLAUDE instead of creating a new root.
 */
export async function scopeUnknownRoot(folderName: string, userId: string, isBrowser: boolean): Promise<string> {
    if (isBrowser || folderName.includes("/")) return folderName;
    const roots = await query<{ folder_name: string }>(
        `SELECT folder_name FROM ${TABLE} WHERE is_folder = true AND parent_folder_name IS NULL AND user_id = $1`,
        [userId]
    );
    const match = fuzzyMatchFolder(roots, folderName);
    return match ? match.folder_name : `CLAUDE/${folderName}`;
}

export async function resolveFolder(
    folderName: string, userId: string, parentHint: string | null, emit: Emit
): Promise<Resolved | { error: string }> {
    const parts = folderName.split("/").map((p) => p.trim()).filter(Boolean);

    if (parts.length <= 1) {
        const folders = await loadFolders(userId);
        const match = fuzzyMatchFolder(folders, folderName, parentHint
            ? (f) => f.parent_folder_name?.toLowerCase() === parentHint.toLowerCase()
            : undefined);
        // Use the real DB name, never the fuzzy input, or the client renders a ghost folder.
        return match ? { folderId: match.id, folderName: match.folder_name } : { folderId: null, folderName };
    }

    const folders = await loadFolders(userId);
    let parentName: string | null = null;
    let parentId: string | null = null;

    for (const segment of parts) {
        const match = fuzzyMatchFolder(folders, segment, (f) =>
            parentName === null ? !f.parent_folder_name : f.parent_folder_name?.toLowerCase() === parentName?.toLowerCase()
        );
        if (match) { parentName = match.folder_name; parentId = match.id; continue; }

        if (parentName === null) {
            return { error: `Root folder "${segment}" does not exist. Create it manually or use an existing folder.` };
        }
        const now = new Date().toISOString();
        const created = await queryOne<FolderRow & Record<string, unknown>>(
            `INSERT INTO ${TABLE} (is_folder, folder_name, title, content, folder_color, parent_folder_name, "order", created_at, updated_at, user_id)
             VALUES (true, $1, $2, '', $3, $4, $5, $6, $7, $8) RETURNING *`,
            [segment, segment, palette12[8], parentName, await getNextOrder(userId, true), now, now, userId]
        );
        if (created) {
            emit("note-created", created);
            folders.push({ id: String(created.id), folder_name: segment, parent_folder_name: parentName });
            parentId = String(created.id);
        }
        parentName = segment;
    }

    // Return the canonical matched name, not the raw last segment: a fuzzy match
    // like "Job Search" -> "Jobs" must not store the input name with the real id.
    return { folderName: parentName ?? parts[parts.length - 1]!, folderId: parentId };
}

/** Create one folder row. Returns the existing id instead when it already exists at this level. */
export async function createFolder(
    name: string, rawColor: string, parent: string | null, icon: string, userId: string, color: string
): Promise<{ conflict: string } | Record<string, unknown>> {
    const dup = await queryOne<{ id: string }>(
        `SELECT id FROM ${TABLE} WHERE is_folder = true AND folder_name = $1
         AND COALESCE(parent_folder_name, '') = $2 AND user_id = $3`,
        [name, parent ?? "", userId]
    );
    if (dup) return { conflict: String(dup.id) };
    const now = new Date().toISOString();
    const row = await queryOne<Record<string, unknown>>(
        `INSERT INTO ${TABLE} (is_folder, folder_name, title, content, folder_color, parent_folder_name, "order", created_at, updated_at, user_id)
         VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [name, name, icon, color, parent, await getNextOrder(userId, true), now, now, userId]
    );
    return row ?? { conflict: "" };
}
