/**
 * The notes surface, mounted twice.
 *
 * /notes is for people: the web app and the native app, holding a JWT.
 * /ext is the same handlers for keyed callers: agents, scripts, automations.
 *
 * The Next.js app split these by rejecting the static key on one path with a
 * 403 that named the other. Keeping both mounts preserves every existing
 * automation's URL while the split stays a routing concern, not an if-branch
 * buried in the handler.
 */
import { Hono } from "hono";
import { requireAuth, forbidExternal } from "../auth/middleware.ts";
import { getNotes } from "../notes/get.ts";
import { postNote } from "../notes/post.ts";
import { patchNote } from "../notes/patch.ts";
import { deleteNote } from "../notes/delete.ts";

const surface = new Hono()
    .use("*", requireAuth)
    .get("/", getNotes)
    .post("/", postNote)
    .patch("/", patchNote)
    .delete("/", forbidExternal, deleteNote);

export const notes = new Hono()
    .route("/notes", surface)
    .route("/ext", surface);
