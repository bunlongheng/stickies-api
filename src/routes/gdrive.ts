/**
 * Google Drive file storage: upload, image proxy, OAuth connect flow, status.
 *
 * Ported from app/api/stickies/gdrive/route.ts, gdrive/auth/route.ts,
 * gdrive/callback/route.ts, gdrive/status/route.ts, upload/route.ts, and
 * gdrive/_oauth-state.ts. Calls the Drive v3 REST API directly with fetch
 * instead of the `googleapis` package - that dependency is ~100MB for the 5
 * endpoints this service actually uses.
 *
 * This service is the single origin now (no separate Next.js app sitting in
 * front of it), so the Next.js route's "proxy to prod when not connected
 * locally" fallback branches are dropped entirely rather than ported.
 */
import crypto from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { requireAuth } from "../auth/middleware.ts";
import { queryOne, execute } from "../db.ts";
import { env } from "../env.ts";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const OAUTH_STATE_COOKIE = "gdrive_oauth_state";
const OAUTH_STATE_MAX_AGE = 600; // 10 minutes - the consent screen's lifetime

// --- OAuth CSRF state -------------------------------------------------------
// The /gdrive/auth start route mints a random state, sets it in an httpOnly
// cookie, AND sends it to Google. /gdrive/callback verifies the state Google
// echoes back matches the cookie (constant-time). Because only the browser
// that STARTED the flow holds the cookie, an attacker-initiated OAuth
// response cannot bind their Drive account into the owner's integration.

function newOAuthState(): string {
    return crypto.randomBytes(32).toString("hex");
}

function verifyOAuthState(returned: string | undefined, cookie: string | undefined): boolean {
    if (!returned || !cookie || returned.length !== cookie.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(returned), Buffer.from(cookie));
    } catch {
        return false;
    }
}

// --- Drive REST helpers ------------------------------------------------------

interface GdriveIntegration { id: string; access_token: string | null; refresh_token: string | null; token_expires_at: string | null }

/** Valid Drive access token, refreshing via the stored refresh_token if needed. */
async function getAccessToken(): Promise<string> {
    const data = await queryOne<GdriveIntegration>(
        `SELECT id, access_token, refresh_token, token_expires_at FROM integrations WHERE type = $1 LIMIT 1`,
        ["gdrive"]
    );
    if (!data?.refresh_token) throw new Error("Google Drive not connected. Go to Settings -> Connect Google Drive.");

    if (data.access_token && data.token_expires_at) {
        const expiresAt = new Date(data.token_expires_at).getTime();
        if (Date.now() < expiresAt - 60_000) return data.access_token;
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: env.googleClientId,
            client_secret: env.googleClientSecret,
            refresh_token: data.refresh_token,
            grant_type: "refresh_token",
        }),
    });

    const tokens = await res.json() as { access_token?: string; expires_in?: number };
    if (!tokens.access_token) throw new Error("Token refresh failed");

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    await execute(`UPDATE integrations SET access_token = $1, token_expires_at = $2 WHERE id = $3`, [tokens.access_token, expiresAt, data.id]);

    return tokens.access_token;
}

async function driveListFolder(accessToken: string, query: string): Promise<{ id: string } | null> {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Drive list failed: HTTP ${res.status}`);
    const data = await res.json() as { files?: Array<{ id: string }> };
    return data.files?.[0] ?? null;
}

async function driveCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
    const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
    });
    if (!res.ok) throw new Error(`Drive folder create failed: HTTP ${res.status}`);
    const data = await res.json() as { id: string };
    return data.id;
}

async function findOrCreateFolder(accessToken: string, parentId: string, name: string): Promise<string> {
    const escaped = name.replace(/'/g, "\\'");
    const query = `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const existing = await driveListFolder(accessToken, query);
    if (existing) return existing.id;
    return driveCreateFolder(accessToken, name, parentId);
}

async function ensureStickiesRoot(accessToken: string): Promise<string> {
    const query = `name = 'Stickies' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
    const existing = await driveListFolder(accessToken, query);
    if (existing) return existing.id;
    return driveCreateFolder(accessToken, "Stickies");
}

/** Multipart upload per the Drive v3 "uploadType=multipart" shape: a JSON metadata part, then the file bytes. */
async function driveUpload(accessToken: string, name: string, parentId: string, mimeType: string, data: Buffer): Promise<{ id: string; webViewLink?: string }> {
    const boundary = `stickies-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [parentId] });
    const head = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        "utf8"
    );
    const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
    const body = new Uint8Array(Buffer.concat([head, data, tail]));

    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
    });
    if (!res.ok) throw new Error(`Drive upload failed: HTTP ${res.status}`);
    return res.json() as Promise<{ id: string; webViewLink?: string }>;
}

async function makePublic(accessToken: string, fileId: string): Promise<void> {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
}

// --- Routes ------------------------------------------------------------------

export const gdrive = new Hono();

async function handleUpload(c: Context): Promise<Response> {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const folderField = formData.get("folder");
    const folder = (typeof folderField === "string" && folderField.trim()) || "unsorted";

    if (!(file instanceof File)) return c.json({ error: "No file" }, 400);

    try {
        const accessToken = await getAccessToken();
        const stickiesId = await ensureStickiesRoot(accessToken);
        const folderId = await findOrCreateFolder(accessToken, stickiesId, folder);

        const buffer = Buffer.from(await file.arrayBuffer());
        const uploaded = await driveUpload(accessToken, file.name, folderId, file.type || "application/octet-stream", buffer);
        await makePublic(accessToken, uploaded.id);

        // Image embed URL: serve through OUR same-origin proxy (GET below)
        // instead of a Drive URL. Drive's thumbnail endpoint 302-redirects
        // (won't load in <img>) and lh3.googleusercontent.com lags for fresh
        // uploads. The proxy streams the bytes server-side with the owner's
        // token - always 200, no CDN lag, no redirect, no permission flakiness.
        const isImage = file.type.startsWith("image/") || /\.(heic|heif|webp|avif|png|jpg|jpeg|gif|svg|bmp|tiff?|ico)$/i.test(file.name);
        const url = isImage ? `/gdrive?img=${uploaded.id}` : (uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`);

        let extractedText = "";
        if (file.type === "application/pdf") {
            try {
                // pdf-parse 2.x replaced the old callable default export with a
                // PDFParse class - the shape used pre-2.x doesn't apply here.
                const { PDFParse } = await import("pdf-parse");
                const parser = new PDFParse({ data: buffer });
                try {
                    const result = await parser.getText();
                    extractedText = result.text ?? "";
                } finally {
                    await parser.destroy();
                }
            } catch (e) {
                console.error("[gdrive] PDF text extraction failed:", e);
            }
        }

        return c.json({ url, name: file.name, type: file.type, extractedText });
    } catch (err) {
        console.error("[gdrive upload]", err instanceof Error ? err.message : err);
        return c.json({ error: err instanceof Error ? err.message : "Upload failed" }, 500);
    }
}

gdrive.post("/gdrive", requireAuth, handleUpload);
gdrive.post("/upload", requireAuth, handleUpload);

/**
 * GET /gdrive?img=<driveFileId> - same-origin image proxy, streams the Drive
 * file's bytes with the owner's token so <img> tags load reliably. Public (no
 * auth): the underlying files are already shared "anyone with link", so this
 * exposes nothing new, and an <img> tag can't send a bearer token anyway.
 */
gdrive.get("/gdrive", async (c: Context): Promise<Response> => {
    const id = c.req.query("img");
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return c.json({ error: "img id required" }, 400);

    try {
        const accessToken = await getAccessToken();
        const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!metaRes.ok) throw new Error(`Drive metadata fetch failed: HTTP ${metaRes.status}`);
        const meta = await metaRes.json() as { mimeType?: string };

        const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!mediaRes.ok) throw new Error(`Drive media fetch failed: HTTP ${mediaRes.status}`);
        const bytes = new Uint8Array(await mediaRes.arrayBuffer());

        return c.body(bytes, 200, {
            "Content-Type": meta.mimeType || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
        });
    } catch (err) {
        console.error("[gdrive img proxy]", err instanceof Error ? err.message : err);
        return c.json({ error: "image fetch failed" }, 502);
    }
});

/** GET /gdrive/auth - redirects to the Google OAuth consent screen for Drive access. */
gdrive.get("/gdrive/auth", requireAuth, (c: Context): Response => {
    if (!env.googleClientId) return c.json({ error: "Google sign-in is not configured" }, 503);

    const redirectUri = `${env.appBaseUrl}/gdrive/callback`;
    const state = newOAuthState();
    const params = new URLSearchParams({
        client_id: env.googleClientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: DRIVE_SCOPE,
        access_type: "offline",
        prompt: "consent",
        state,
    });

    setCookie(c, OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "Lax",
        secure: env.isProd,
        path: "/gdrive",
        maxAge: OAUTH_STATE_MAX_AGE,
    });

    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});

function doneRedirect(c: Context, query: string): Response {
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/gdrive" });
    return c.redirect(`${env.appBaseUrl}/?${query}`, 302);
}

/** GET /gdrive/callback - receives the OAuth code from Google, exchanges it, stores the tokens. Unauthenticated: the state cookie IS the auth check. */
gdrive.get("/gdrive/callback", async (c: Context): Promise<Response> => {
    const returnedState = c.req.query("state");
    const code = c.req.query("code");
    const errorParam = c.req.query("error");
    const cookieState = getCookie(c, OAUTH_STATE_COOKIE);

    // CSRF check first: the state Google echoes back must match the cookie
    // the browser got when it STARTED the flow. Without this, a lured click
    // could bind an attacker's Drive account into the integration.
    if (!verifyOAuthState(returnedState, cookieState)) return doneRedirect(c, "gdrive=error&msg=bad_state");
    if (errorParam || !code) return doneRedirect(c, `gdrive=error&msg=${encodeURIComponent(errorParam || "no_code")}`);

    try {
        const redirectUri = `${env.appBaseUrl}/gdrive/callback`;
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: env.googleClientId,
                client_secret: env.googleClientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
        });

        const tokens = await tokenRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
        if (!tokens.refresh_token) {
            console.error("[gdrive callback] No refresh token:", tokens);
            return doneRedirect(c, "gdrive=error&msg=no_refresh_token");
        }

        const existing = await queryOne<{ id: string }>(`SELECT id FROM integrations WHERE type = $1 LIMIT 1`, ["gdrive"]);
        const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

        if (existing) {
            await execute(
                `UPDATE integrations SET access_token = $1, refresh_token = $2, token_expires_at = $3, active = true WHERE id = $4`,
                [tokens.access_token, tokens.refresh_token, expiresAt, existing.id]
            );
        } else {
            await execute(
                `INSERT INTO integrations (name, type, trigger, condition, config, active, access_token, refresh_token, token_expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                ["Google Drive", "gdrive", "upload", "{}", "{}", true, tokens.access_token, tokens.refresh_token, expiresAt]
            );
        }

        return doneRedirect(c, "gdrive=connected");
    } catch (err) {
        console.error("[gdrive callback]", err);
        return doneRedirect(c, `gdrive=error&msg=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`);
    }
});

/** GET /gdrive/status - whether Google Drive is connected. */
gdrive.get("/gdrive/status", requireAuth, async (c: Context): Promise<Response> => {
    const data = await queryOne<{ refresh_token: string | null; active: boolean }>(
        `SELECT refresh_token, active FROM integrations WHERE type = $1 LIMIT 1`,
        ["gdrive"]
    );
    const connected = !!(data?.refresh_token && data.active);
    // The Next.js app also reported connected via a proxy-to-prod fallback
    // when running without local credentials. This service is the single
    // origin now, so there is no prod instance to proxy to - via stays
    // local|none, never proxy.
    return c.json({ connected, via: connected ? "local" : "none" });
});
