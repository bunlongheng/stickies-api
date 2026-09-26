/**
 * The public share surface. Everything here is unauthenticated by design and
 * gated on the note's own `is_public` flag, with an optional passcode.
 *
 * Mounted at /public, /share and /raw. /share and /raw are the links already in
 * the wild, so they stay as permanent aliases.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { queryOne } from "../db.ts";
import { wrapHtmlWithTheme } from "../lib/html.ts";
import { escapeHtml, ogMeta, gatePageHtml } from "../lib/share-html.ts";
import { REVEAL_STYLE, unlockedSuccessPage } from "../lib/share-pages.ts";
import { verifyLockPassword, signUnlockCookie, verifyUnlockCookie, unlockCookieName } from "../lib/lock-password.ts";

export const publicShare = new Hono();

// Shared links are embedded from anywhere, so this surface is deliberately open.
// The original set these on OPTIONS and GET but NOT on the POST responses, so a
// cross-origin passcode submit failed despite OPTIONS advertising POST.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
} as const;

type ShareRow = {
    title: string; content: string; type: string | null;
    folder_color: string; is_public: boolean; locked: boolean; lock_password_hash: string | null;
};

const SELECT = `SELECT title, content, type, folder_color, is_public, locked, lock_password_hash
                FROM "stickies" WHERE id = $1 AND trashed_at IS NULL`;

const theme = (c: Context): "dark" | "light" =>
    c.req.query("theme") === "dark" ? "dark" : "light";

const notFound = (c: Context): Response =>
    c.body("Not found", 404, { ...CORS, "Content-Type": "text/plain; charset=utf-8" });

/**
 * Per-IP throttle on the passcode gate: 10 attempts per 5 minutes. The whole
 * map is dropped past 5000 entries so a spray cannot grow it without bound.
 */
const gateHits = new Map<string, { n: number; resetAt: number }>();
const GATE_MAX = 10;
const GATE_WINDOW_MS = 5 * 60 * 1000;

function gateRateLimited(ip: string): boolean {
    const now = Date.now();
    if (gateHits.size > 5000) gateHits.clear();
    const hit = gateHits.get(ip);
    if (!hit || now > hit.resetAt) { gateHits.set(ip, { n: 1, resetAt: now + GATE_WINDOW_MS }); return false; }
    hit.n += 1;
    return hit.n > GATE_MAX;
}

/** JSON read used by the web app's share viewer. */
publicShare.get("/public", async (c): Promise<Response> => {
    const noteId = c.req.query("noteId");
    if (!noteId) return c.json({ error: "Missing noteId" }, 400);
    const row = await queryOne<ShareRow>(SELECT, [noteId]);
    // A private note and a missing note answer identically, so the response
    // never confirms that an id exists.
    if (!row || !row.is_public) return c.json({ error: "Not found" }, 404);

    if (row.locked && row.lock_password_hash) {
        const cookie = getCookie(c, unlockCookieName(noteId));
        if (!verifyUnlockCookie(noteId, row.lock_password_hash, cookie)) {
            return c.json({ locked: true, title: row.title, folder_color: row.folder_color });
        }
    }
    return c.json({ title: row.title, content: row.content, type: row.type, folder_color: row.folder_color });
});

function contentResponse(origin: string, noteId: string, row: ShareRow, forceText: boolean, dark: boolean, unlocked: boolean): Response {
    const isHtml = !forceText && row.type === "html";
    const headers: Record<string, string> = {
        ...CORS,
        "Content-Type": isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "X-Note-Title": encodeURIComponent(row.title),
        "Cache-Control": "private, max-age=0, no-store",
    };
    if (!isHtml) return new Response(row.content, { headers });

    // A shared HTML note runs author-supplied markup. The opaque-origin sandbox
    // lets it script itself while keeping it away from the owner's cookies.
    headers["Content-Security-Policy"] = "sandbox allow-scripts allow-popups";
    let html = wrapHtmlWithTheme(row.content, dark);
    const head = [
        `<meta name="viewport" content="width=device-width, initial-scale=1">`,
        // Do not fight a title the note already sets for itself.
        /<title[\s>]/i.test(html) ? "" : `<title>${escapeHtml(row.title)}</title>`,
        ogMeta(origin, noteId, row.title),
        unlocked ? REVEAL_STYLE : "",
    ].join("");
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${head}`);
    return new Response(html, { headers });
}

async function renderShare(c: Context): Promise<Response> {
    const noteId = c.req.query("noteId");
    if (!noteId) return notFound(c);
    const row = await queryOne<ShareRow>(SELECT, [noteId]);
    if (!row || !row.is_public) return notFound(c);

    const dark = theme(c) === "dark";
    if (row.locked && row.lock_password_hash) {
        const cookie = getCookie(c, unlockCookieName(noteId));
        if (!verifyUnlockCookie(noteId, row.lock_password_hash, cookie)) {
            return c.html(gatePageHtml(new URL(c.req.url).origin, noteId, row.title, false, theme(c)), 200, {
                ...CORS, "Cache-Control": "no-store",
            });
        }
    }
    return contentResponse(new URL(c.req.url).origin, noteId, row, c.req.query("as") === "text", dark, c.req.query("unlocked") === "1");
}

async function submitPasscode(c: Context): Promise<Response> {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip")?.trim() ?? "unknown";
    if (gateRateLimited(ip)) {
        return c.body("Too many attempts. Wait a few minutes and try again.", 429, {
            ...CORS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300",
        });
    }

    const noteId = c.req.query("noteId");
    if (!noteId) return notFound(c);
    const row = await queryOne<ShareRow>(SELECT, [noteId]);
    if (!row || !row.is_public) return notFound(c);

    // The owner may have unlocked the note between render and submit.
    if (!row.locked || !row.lock_password_hash) return c.redirect(`/share?noteId=${encodeURIComponent(noteId)}`, 302);

    const form = await c.req.formData().catch(() => null);
    const password = String(form?.get("password") ?? "").trim();
    if (!(await verifyLockPassword(password, row.lock_password_hash))) {
        return c.html(gatePageHtml(new URL(c.req.url).origin, noteId, row.title, true, theme(c)), 401, {
            ...CORS, "Cache-Control": "no-store",
        });
    }

    setCookie(c, unlockCookieName(noteId), signUnlockCookie(noteId, row.lock_password_hash), {
        httpOnly: true,
        sameSite: "Lax",
        secure: c.req.url.startsWith("https://"),
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
    });
    const target = `/share?noteId=${encodeURIComponent(noteId)}&theme=${theme(c)}&unlocked=1`;
    return c.html(unlockedSuccessPage(target, theme(c) === "dark"), 200, { ...CORS, "Cache-Control": "no-store" });
}

for (const path of ["/share", "/raw"]) {
    publicShare.options(path, (c) => c.body(null, 204, CORS));
    publicShare.get(path, (c) => {
        // Clip links moved to their own surface; keep the old ones resolving.
        const url = new URL(c.req.url);
        if (url.searchParams.has("clip") || url.searchParams.has("data")) {
            return c.redirect(`/clip${url.search}`, 308);
        }
        return renderShare(c);
    });
    publicShare.post(path, submitPasscode);
}
