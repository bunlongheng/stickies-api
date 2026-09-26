/**
 * POST /local - the simplified create the shell scripts on the hub use.
 *
 * Kept as its own path because those scripts are already deployed against it.
 * It differs from POST /notes in 3 ways: no folder resolution (the folder name
 * is stored as given), no icon or type detection, and the Hue flash fires for
 * every caller rather than external ones only.
 */
import { Hono } from "hono";
import { queryOne } from "../db.ts";
import { requireAuth, caller } from "../auth/middleware.ts";
import { broadcast } from "../realtime/sse.ts";
import { livePayload } from "../lib/live-payload.ts";
import { TABLE, getNextOrder } from "../notes/helpers.ts";
import { splitRawText } from "../notes/title.ts";
import { flashOnNewNote } from "../integrations/hue.ts";

export const local = new Hono();

const DEFAULT_COLOR = "#B0B0B8";

/**
 * The flash and the broadcast are serialized behind one promise chain so 2
 * notes arriving together do not race the bridge into a half-applied colour.
 */
let flashQueue: Promise<unknown> = Promise.resolve();

local.post("/local", requireAuth, async (c): Promise<Response> => {
    const { userId } = caller(c);
    const folderParam = c.req.query("folder")?.trim() || "CLAUDE";
    const color = c.req.query("color")?.trim() || DEFAULT_COLOR;
    const contentType = c.req.header("content-type") ?? "";

    let title = "", content = "", folderName = folderParam;
    if (/text\/(plain|markdown|x-markdown)/i.test(contentType)) {
        const split = splitRawText(await c.req.text());
        title = split.title;
        content = split.content;
    } else {
        const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
        if (!body) return c.json({ error: "Invalid body" }, 400);
        title = String(body.title ?? "").trim();
        content = String(body.content ?? "").trim();
        folderName = String(body.folder ?? body.folder_name ?? folderParam).trim() || "CLAUDE";
    }

    if (!title) return c.json({ error: "title required" }, 400);
    if (!content) return c.json({ error: "content required" }, 400);

    const now = new Date().toISOString();
    const note = await queryOne<Record<string, unknown>>(
        `INSERT INTO ${TABLE} (title, content, folder_name, is_folder, folder_color, "order", created_at, updated_at, user_id)
         VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8) RETURNING *`,
        [title, content, folderName, color, await getNextOrder(userId, false), now, now, userId]
    );
    if (!note) return c.json({ error: "Database error" }, 500);

    // The response goes out first; the flash and the broadcast finish after it.
    flashQueue = flashQueue.then(async () => {
        const flash = flashOnNewNote(color);
        await new Promise((r) => setTimeout(r, 300));
        broadcast(userId, "note-created", livePayload(note));
        await flash;
    }).catch(() => {});

    return c.json({ note }, 201);
});
