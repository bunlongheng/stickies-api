/**
 * Sign-in for stickies-web and stickies-native.
 *
 * The Next.js app used NextAuth cookie sessions, which a Swift client cannot
 * carry, so the native app had no real auth at all - /auth/native-callback was
 * a 503 stub and the app fell back to pasting STICKIES_API_KEY. Both clients
 * now do the same thing: get a Google id_token, trade it here for an access
 * plus refresh pair, and send the access token as a bearer.
 *
 * Native runs the Google flow in ASWebAuthenticationSession, web runs it in the
 * page. Neither needs a client secret, because the id_token is verified against
 * Google's public keys and the audience is pinned to our own client id.
 */
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env.ts";
import { queryOne } from "../db.ts";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/jwt.ts";

export const auth = new Hono();

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

interface GoogleIdentity { sub: string; email: string; emailVerified: boolean }

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
    try {
        const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
            issuer: ["https://accounts.google.com", "accounts.google.com"],
            audience: env.googleClientId,
        });
        if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
        return { sub: payload.sub, email: payload.email, emailVerified: payload.email_verified === true };
    } catch { return null; }
}

/**
 * Single-user app: only OWNER_EMAIL may sign in. With no owner configured this
 * fails closed rather than letting any Google account in, which is what the
 * NextAuth signIn callback did.
 */
function ownerGate(email: string): boolean {
    if (!env.ownerEmail) {
        console.warn("[auth] OWNER_EMAIL is not set, refusing every sign-in");
        return false;
    }
    return email.toLowerCase() === env.ownerEmail;
}

/** Resolve the row in `users` so tokens carry a stable subject across sign-ins. */
async function userIdFor(email: string): Promise<string> {
    const row = await queryOne<{ id: string | number }>(`SELECT id FROM users WHERE lower(email) = $1`, [email.toLowerCase()]);
    return row ? String(row.id) : env.ownerUserId;
}

auth.post("/auth/google", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { id_token?: unknown };
    const idToken = typeof body.id_token === "string" ? body.id_token : "";
    if (!idToken) return c.json({ error: "id_token is required" }, 400);
    if (!env.googleClientId) return c.json({ error: "Google sign-in is not configured" }, 503);

    const identity = await verifyGoogleIdToken(idToken);
    if (!identity) return c.json({ error: "Invalid id_token" }, 401);
    // An unverified address can be claimed by someone who does not own it.
    if (!identity.emailVerified) return c.json({ error: "Email is not verified" }, 403);
    if (!ownerGate(identity.email)) return c.json({ error: "Forbidden" }, 403);

    const claims = { sub: await userIdFor(identity.email), email: identity.email };
    return c.json({
        access_token: await signAccessToken(claims),
        refresh_token: await signRefreshToken(claims),
        token_type: "Bearer",
        expires_in: 900,
        user: { id: claims.sub, email: claims.email },
    });
});

auth.post("/auth/refresh", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { refresh_token?: unknown };
    const token = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (!token) return c.json({ error: "refresh_token is required" }, 400);

    const claims = await verifyRefreshToken(token);
    if (!claims) return c.json({ error: "Invalid refresh token" }, 401);
    // Re-check the gate on every refresh: revoking an owner must not leave a
    // 60-day refresh token minting fresh access tokens for 2 more months.
    if (!ownerGate(claims.email)) return c.json({ error: "Forbidden" }, 403);

    return c.json({
        access_token: await signAccessToken(claims),
        token_type: "Bearer",
        expires_in: 900,
    });
});

/**
 * Stateless tokens cannot be revoked server-side without a denylist, which is
 * not worth the table for a single-user app. The client drops its tokens and
 * the access token is dead in 15 minutes.
 */
auth.post("/auth/logout", (c) => c.json({ ok: true }));
