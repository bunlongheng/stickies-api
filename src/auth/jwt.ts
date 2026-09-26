/**
 * Token issuing for stickies-web and stickies-native.
 *
 * The Next.js app used NextAuth cookie sessions, which a Swift client cannot
 * carry. Here the browser and the native app hold the same pair: a short-lived
 * access token sent as `Authorization: Bearer`, and a long-lived refresh token
 * that is the only thing either client needs to persist.
 */
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.ts";

const secret = new TextEncoder().encode(env.authSecret);
const ISSUER = "stickies-api";
const ACCESS_TTL = "15m";
const REFRESH_TTL = "60d";

export interface Claims { sub: string; email: string }

async function sign(claims: Claims, kind: "access" | "refresh", ttl: string): Promise<string> {
    return new SignJWT({ email: claims.email, kind })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(claims.sub)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(ttl)
        .sign(secret);
}

export const signAccessToken = (c: Claims) => sign(c, "access", ACCESS_TTL);
export const signRefreshToken = (c: Claims) => sign(c, "refresh", REFRESH_TTL);

async function verify(token: string, kind: "access" | "refresh"): Promise<Claims | null> {
    try {
        const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
        // A refresh token must never be accepted as an access token: it outlives
        // the access TTL by 60 days, so mixing them erases the short-TTL guarantee.
        if (payload.kind !== kind) return null;
        if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
        return { sub: payload.sub, email: payload.email };
    } catch { return null; }
}

export const verifyAccessToken = (t: string) => verify(t, "access");
export const verifyRefreshToken = (t: string) => verify(t, "refresh");
