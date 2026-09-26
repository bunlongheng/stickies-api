/**
 * POST /notes - 6 body shapes on 1 path, selected by content-type and body form.
 */
import type { Context } from "hono";
import { queryOne } from "../db.ts";
import { caller } from "../auth/middleware.ts";
import { broadcast } from "../realtime/sse.ts";
import { livePayload } from "../lib/live-payload.ts";
import { colorName, stripEmoji } from "../lib/note-format.ts";
import { normalizeIcon, pickNoteIcon, SUPPORTED_NOTE_ICONS } from "../lib/note-icons.ts";
import { isReservedFolderName, remapReservedFolderPath } from "../lib/reserved-folders.ts";
import { TABLE, withUser, getNextOrder, detectType, VALID_TYPES, RAW_INSERT_ALLOWED_COLS, pickLeastUsedColor } from "./helpers.ts";
import { resolveFolder, scopeUnknownRoot, createFolder } from "./folders.ts";
import { runBatch, expandCompactArray, BATCH_LIMIT, type BatchItem } from "./batch.ts";
import { attributionFor } from "./attribution.ts";
import { deriveTitle, splitRawText } from "./title.ts";
import { flashOnNewNote } from "../integrations/hue.ts";
import { announceRequest } from "./announce.ts";

/** An agent that sends an unsupported icon gets the full list back, not a bare 422. */
const iconRejection = (c: Context, bad: unknown) => c.json({
    ok: false,
    code: "unsupported_icon",
    error: `Icon "${String(bad)}" is not supported. Pick one from the supported list and resubmit.`,
    how_to_fix: `Set "icon" to one of the supported names (with or without the "__hero:" prefix), e.g. icon:"RocketLaunchIcon". Omit "icon" entirely and we will auto-pick one for you.`,
    supported_icons: SUPPORTED_NOTE_ICONS,
}, 422);

export async function postNote(c: Context): Promise<Response> {
    const who = caller(c);
    const { userId, type: callerType } = who;
    const isExternal = callerType === "external";
    const q = c.req.query();
    const contentType = c.req.header("content-type") ?? "";
    const attr = await attributionFor(c, who);
    const emit = (event: Parameters<typeof broadcast>[1], payload: unknown) => broadcast(userId, event, payload);

    const isRawText = /text\/(plain|markdown|x-markdown)/i.test(contentType);
    let body: unknown = null;
    if (/application\/json/i.test(contentType)) {
        try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    }

    announceRequest(c, who, body);

    // Shapes 3 + 4: compact array and explicit batch.
    const items: BatchItem[] | null = Array.isArray(body)
        ? expandCompactArray(body as unknown[][])
        : Array.isArray((body as { batch?: unknown })?.batch)
            ? ((body as { batch: BatchItem[] }).batch)
            : null;
    if (items) {
        if (items.length > BATCH_LIMIT) return c.json({ error: `Batch limit is ${BATCH_LIMIT} items per request` }, 400);
        const { results, failed } = await runBatch(items, userId, isExternal, attr, emit);
        return c.json({ results, total: results.length, failed }, failed === results.length ? 500 : 201);
    }

    const obj = (body ?? {}) as Record<string, unknown>;

    // Shape 6: folder create.
    if (q.type === "folder" || obj.type === "folder") {
        const name = String(q.name ?? obj.name ?? "").trim();
        if (!name) return c.json({ error: "name is required for folder" }, 400);
        if (isReservedFolderName(name)) return c.json({ error: `"Today"/"Yesterday" are virtual views, not folders` }, 400);
        const parent = String(q.parent ?? obj.parent_folder ?? "").trim() || (isExternal ? "CLAUDE" : null);
        const color = await pickLeastUsedColor(userId, String(q.color ?? obj.color ?? ""), true);
        const created = await createFolder(name, "", parent, String(q.icon ?? obj.icon ?? "").trim(), userId, color);
        if ("conflict" in created) return c.json({ error: "Folder already exists", id: created.conflict }, 409);
        emit("note-created", livePayload(created));
        return c.json({ folder: created }, 201);
    }

    // Shape 5: raw insert, column whitelist enforced.
    if (q.raw === "1") {
        const now = new Date().toISOString();
        const payload: Record<string, unknown> = { ...obj, updated_at: now, created_at: obj.created_at ?? now, user_id: userId };
        if (attr.createdByKey) payload.created_by_key = attr.createdByKey;
        if (attr.createdByMachine) payload.created_by_machine = attr.createdByMachine;
        const filtered = Object.fromEntries(
            Object.entries(payload).filter(([k]) => RAW_INSERT_ALLOWED_COLS.has(k) || k === "user_id")
        );
        if (Object.keys(filtered).length === 0) return c.json({ error: "No valid columns provided" }, 400);
        // External callers may not create root folders.
        const rawIsFolder = filtered.is_folder === true || filtered.is_folder === "true";
        if (isExternal && rawIsFolder && !String(filtered.parent_folder_name ?? "").trim()) {
            filtered.parent_folder_name = "CLAUDE";
        }
        const cols = Object.keys(filtered).map((k) => `"${k}"`).join(", ");
        // `doc` is JSONB: node-pg stringifies a raw object to "[object Object]".
        const vals = Object.entries(filtered).map(([k, v]) => (k === "doc" && v !== null && typeof v === "object" ? JSON.stringify(v) : v));
        const note = await queryOne<Record<string, unknown>>(
            `INSERT INTO ${TABLE} (${cols}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, vals
        );
        if (!note) return c.json({ error: "Database error" }, 500);
        emit("note-created", livePayload(note));
        return c.json({ note }, 201);
    }

    // Shapes 1 + 2: a single note, as JSON or as a raw markdown body.
    let title = "", content = "", folderRaw = "", rawColor = "", parentHint: string | null = null;
    let explicitType: string | null = null;
    let rawIcon: unknown;
    // A re-posted note should surface at the top rather than stay buried behind
    // everything created since its first post, which reads as "incoming stopped
    // working". Send resurface:false for a silent edit.
    let resurface = true;

    if (isRawText) {
        const split = splitRawText(await c.req.text());
        title = split.title; content = split.content;
        folderRaw = q.folder?.trim() || "CLAUDE";
        if (q.color?.trim()) rawColor = q.color.trim().toUpperCase();
        if (q.type && VALID_TYPES.has(q.type)) explicitType = q.type;
        rawIcon = q.icon;
    } else {
        if (body === null) return c.json({ error: "Invalid body - send JSON or raw markdown text" }, 400);
        title = typeof obj.title === "string" ? obj.title.trim() : "";
        content = typeof obj.content === "string" ? obj.content : "";
        folderRaw = ((typeof obj.folder === "string" ? obj.folder : "") || (typeof obj.folder_name === "string" ? obj.folder_name : "")).trim() || "CLAUDE";
        rawColor = typeof obj.color === "string" ? obj.color.trim().toUpperCase() : "";
        parentHint = typeof obj.parent_folder === "string" ? obj.parent_folder.trim() : null;
        const bodyType = typeof obj.type === "string" ? obj.type.trim().toLowerCase() : null;
        if (bodyType && VALID_TYPES.has(bodyType)) explicitType = bodyType;
        rawIcon = obj.icon;
        resurface = obj.resurface !== false;
    }

    // Keep API titles clean text: emoji clash with the tile icon.
    title = stripEmoji(deriveTitle(title, content)) || "Untitled";
    if (!content.trim()) return c.json({ error: "content required" }, 400);
    if (!folderRaw.trim()) return c.json({ error: "folder cannot be empty" }, 400);

    // Reject a bad icon BEFORE any DB work so the caller can resubmit cheaply.
    let suppliedIcon: string | null = null;
    if (rawIcon !== undefined && rawIcon !== null && String(rawIcon).trim() !== "") {
        suppliedIcon = normalizeIcon(rawIcon);
        if (!suppliedIcon) return iconRejection(c, rawIcon);
    }

    const isBrowser = /mozilla/i.test(c.req.header("user-agent") ?? "");
    const scoped = await scopeUnknownRoot(remapReservedFolderPath(folderRaw), userId, isBrowser);
    const resolved = await resolveFolder(scoped, userId, parentHint, emit);
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);

    const color = await pickLeastUsedColor(userId, rawColor, false);
    const noteType = explicitType ?? detectType(content, title);
    const now = new Date().toISOString();

    // Upsert-by-title is for external callers ONLY: an agent re-POSTing the same
    // title updates its note in place. Owner posts always INSERT, because notes
    // are keyed by id and the same title must never silently overwrite another.
    let existingId: string | null = null;
    if (isExternal) {
        const { sql, params } = withUser(
            `SELECT id::text AS id FROM ${TABLE} WHERE is_folder = false AND folder_name = $1 AND title = $2`,
            [resolved.folderName, title], userId
        );
        existingId = (await queryOne<{ id: string }>(`${sql} LIMIT 1`, params))?.id ?? null;
    }

    let note: Record<string, unknown> | null;
    if (existingId) {
        // Only touch the icon when the agent explicitly sent one, so a plain
        // content re-post does not clobber a manually-set icon.
        const sets = [`content = $1`, `folder_color = $2`, `type = $3`, `updated_at = $4`];
        const vals: unknown[] = [content, color, noteType, now];
        if (suppliedIcon) { sets.push(`icon = $${vals.length + 1}`); vals.push(suppliedIcon); }
        if (resurface) { sets.push(`created_at = $${vals.length + 1}`); vals.push(now); }
        vals.push(existingId);
        note = await queryOne(`UPDATE ${TABLE} SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
    } else {
        const cols = [`title`, `content`, `folder_name`, `folder_color`, `is_folder`, `type`, `icon`, `"order"`, `created_at`, `updated_at`, `user_id`];
        const vals: unknown[] = [title, content, resolved.folderName, color, false, noteType,
            suppliedIcon ?? pickNoteIcon(title, content, noteType), await getNextOrder(userId, false), now, now, userId];
        if (resolved.folderId) { cols.push(`folder_id`); vals.push(resolved.folderId); }
        if (attr.createdByKey) { cols.push(`created_by_key`); vals.push(attr.createdByKey); }
        if (attr.createdByMachine) { cols.push(`created_by_machine`); vals.push(attr.createdByMachine); }
        note = await queryOne(
            `INSERT INTO ${TABLE} (${cols.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, vals
        );
    }
    if (!note) return c.json({ error: "Database error" }, 500);

    // A resurfaced re-post is effectively a NEW arrival: broadcast note-created so
    // clients without the old row loaded ADD it, instead of a note-updated that
    // no-ops on a note they never had.
    emit(existingId && !resurface ? "note-updated" : "note-created", livePayload(note));
    if (isExternal) void flashOnNewNote(String(note.folder_color ?? color));

    const action = existingId ? "updated" : "created";
    const saved = String(note.folder_color ?? color);
    return c.json({
        ok: true, action,
        message: `Successfully ${action}. Your sticky color is ${colorName(saved)} (${saved}).`,
        color: saved, color_name: colorName(saved), note,
    }, 201);
}
