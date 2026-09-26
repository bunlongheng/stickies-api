/**
 * Shared Hue bridge plumbing for the /hue/trigger and /hue/groups routes.
 *
 * The Next.js app had this verbatim in 2 places - app/api/hue/trigger/route.ts
 * and app/api/hue/groups/route.ts both defined their own copy of localFetch,
 * getRemoteToken, and the token-refresh UPDATE. One copy here, imported by
 * both route handlers, so the refresh logic can't drift between them again.
 */
import https from "node:https";
import { execute } from "../db.ts";

export interface HueIntegration {
    id: string;
    config: {
        app_key?: string;
        group_id?: string;
        bridge_ip?: string;
        mode?: string;
        client_id?: string;
        client_secret?: string;
    } | null;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: string | null;
}

export interface XY { x: number; y: number }

export function hexToXy(hex: string): XY {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const rL = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    const gL = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    const bL = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    const X = rL * 0.664511 + gL * 0.154324 + bL * 0.162028;
    const Y = rL * 0.283881 + gL * 0.668433 + bL * 0.047685;
    const Z = rL * 0.000088 + gL * 0.072310 + bL * 0.986039;
    const sum = X + Y + Z;
    if (sum === 0) return { x: 0.3127, y: 0.3290 };
    return { x: Math.round((X / sum) * 10000) / 10000, y: Math.round((Y / sum) * 10000) / 10000 };
}

/**
 * Local bridge fetch - only works when this process is on the home LAN, which
 * is why the remote Hue API is tried first everywhere this is used.
 */
export function localFetch(bridgeIp: string, appKey: string, path: string, method = "GET", body?: object): Promise<any> {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const req = https.request({
            hostname: bridgeIp,
            port: 443,
            path,
            method,
            headers: {
                "hue-application-key": appKey,
                "Content-Type": "application/json",
                ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
            },
            agent: new https.Agent({ rejectUnauthorized: false }),
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/** Valid Remote API access token from the integrations row, refreshed if needed. */
export async function getRemoteToken(integration: HueIntegration): Promise<string | null> {
    const clientId = integration.config?.client_id?.trim();
    const clientSecret = integration.config?.client_secret?.trim();
    if (!clientId || !clientSecret) return null;
    if (!integration.access_token) return null;

    // Token still valid.
    if (integration.token_expires_at && Date.now() < new Date(integration.token_expires_at).getTime() - 60_000) {
        return integration.access_token;
    }
    // Strict mode wants a string for URLSearchParams; a missing refresh_token
    // can't refresh regardless, so fail the same way the fetch below would.
    if (!integration.refresh_token) return null;

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://api.meethue.com/v2/oauth2/token", {
        method: "POST",
        headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: integration.refresh_token }),
    });
    if (!res.ok) return null;

    const tokens = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tokens.access_token) return null;
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 604800) * 1000).toISOString();

    await execute(
        `UPDATE integrations SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = $4 WHERE id = $5`,
        [tokens.access_token, tokens.refresh_token ?? integration.refresh_token, tokenExpiresAt, new Date().toISOString(), integration.id]
    );

    return tokens.access_token;
}
