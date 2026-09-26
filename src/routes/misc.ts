/**
 * Small standalone endpoints that don't belong to any one surface.
 */
import { Hono } from "hono";
import { env } from "../env.ts";

export const misc = new Hono();

/**
 * CSP violation sink. A report-only policy with no endpoint is inert by spec
 * (Safari warns about it in the console), so this always answers 204 no
 * matter what the body looks like - a violation report must never surface as
 * an error to the reporting browser.
 */
misc.post("/csp-report", async (c) => {
    if (!env.isProd) {
        try {
            // Legacy browsers send {"csp-report": {...}}; the Reporting API
            // sends an array of {type, body}. Both shapes are accepted.
            const body = (await c.req.json()) as unknown;
            const reports = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
            for (const r of reports) {
                const v = (r?.body ?? r?.["csp-report"] ?? r) as Record<string, unknown>;
                const directive = v?.effectiveDirective ?? v?.["effective-directive"] ?? "?";
                const blocked = v?.blockedURL ?? v?.["blocked-uri"] ?? "?";
                console.warn(`[csp] ${directive} blocked ${blocked}`);
            }
        } catch {
            // A malformed report is not worth failing on - the endpoint stays quiet.
        }
    }
    return c.body(null, 204);
});

/**
 * Build id for stale-tab detection. The Next.js app read .next/BUILD_ID off
 * disk; this service has no Next build output, so the id is set explicitly at
 * deploy time via STICKIES_BUILD_ID instead. Unauthenticated - it leaks
 * nothing beyond a build hash and must answer before any session work.
 */
misc.get("/build-id", (c) => c.json({ id: env.buildId }, 200, { "Cache-Control": "no-store" }));
