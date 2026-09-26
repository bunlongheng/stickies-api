/**
 * Philips Hue flash trigger + light group listing.
 *
 * Ported from app/api/hue/trigger/route.ts (POST + DELETE) and
 * app/api/hue/groups/route.ts (GET). Both originals hand-rolled the same
 * bridge plumbing; it now lives once in ../integrations/hue-bridge.ts.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "../auth/middleware.ts";
import { queryOne } from "../db.ts";
import { hexToXy, localFetch, getRemoteToken, type HueIntegration, type XY } from "../integrations/hue-bridge.ts";

const RESTORE_DELAY = 60_000; // 1 minute of inactivity -> restore

// Module-level debounce state, same shape as the Next.js route. It only
// matters within one process's uptime, which is fine for a single-instance
// service holding the one Hue integration.
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let origXySnapshot: XY | null = null;
let origBrightnessSnapshot: number | null = null;
let lastTriggerAt = 0; // epoch ms - updated on every incoming trigger

/** Schedule a restore back to the original color after 1m of inactivity. */
function scheduleRestore(targetGroup: string, via: "remote" | "local", token: string | null, bridgeIp: string | undefined, appKey: string): void {
    if (restoreTimer) clearTimeout(restoreTimer);

    restoreTimer = setTimeout(async () => {
        // Abort if a new trigger arrived while this timer was waiting.
        if (Date.now() - lastTriggerAt < RESTORE_DELAY - 1_000) return;

        const xy = origXySnapshot ?? { x: 0.3127, y: 0.3290 };
        const bri = origBrightnessSnapshot ?? 100;
        origXySnapshot = null;
        origBrightnessSnapshot = null;
        restoreTimer = null;

        try {
            if (via === "remote" && token) {
                const freshInt = await queryOne<HueIntegration>(`SELECT * FROM integrations WHERE type = 'hue' AND active = true LIMIT 1`);
                const freshToken = freshInt ? await getRemoteToken(freshInt) : token;
                if (!freshToken) return;
                const base = `https://api.meethue.com/route/clip/v2/resource/grouped_light/${targetGroup}`;
                const headers = { "Authorization": `Bearer ${freshToken}`, "hue-application-key": appKey, "Content-Type": "application/json" };
                await fetch(base, { method: "PUT", headers, body: JSON.stringify({ color: { xy }, dimming: { brightness: bri } }) });
            } else if (via === "local" && bridgeIp) {
                await localFetch(bridgeIp, appKey, `/clip/v2/resource/grouped_light/${targetGroup}`, "PUT", { color: { xy }, dimming: { brightness: bri } });
            }
        } catch {
            // Best-effort restore - silently ignore.
        }
    }, RESTORE_DELAY);
}

async function loadIntegration(): Promise<HueIntegration | null> {
    return queryOne<HueIntegration>(`SELECT * FROM integrations WHERE type = $1 AND active = true LIMIT 1`, ["hue"]);
}

export const hue = new Hono();
hue.use("*", requireAuth);

hue.post("/hue/trigger", async (c: Context): Promise<Response> => {
    lastTriggerAt = Date.now(); // stamp immediately - blocks any pending restore timer

    const integration = await loadIntegration();
    if (!integration) return c.json({ ok: false, error: "No active Hue integration found" }, 503);

    const appKey = integration.config?.app_key?.trim();
    const groupId = integration.config?.group_id?.trim();
    const bridgeIp = integration.config?.bridge_ip?.trim();
    const mode = integration.config?.mode ?? "flash"; // "flash" | "ambient" | "off"

    if (!groupId) return c.json({ ok: false, error: "group_id not configured" }, 503);
    if (!appKey) return c.json({ ok: false, error: "app_key not configured" }, 503);
    if (mode === "off") return c.json({ ok: false, reason: "light mode is off" });

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    // Note-triggered flashes (the caller sends source:"note_created") must
    // respect the "Note Created -> Hue Flash" automation toggle. Without this
    // gate the flash fires regardless of the switch, because this route
    // otherwise only checks the INTEGRATION's active/mode. Manual/other
    // callers omit `source` and are unaffected.
    if (body.source === "note_created") {
        const autom = await queryOne<{ active: boolean }>(
            `SELECT active FROM automations WHERE trigger_type = 'note_created' AND action_type = 'hue_flash' ORDER BY created_at LIMIT 1`
        );
        if (autom && autom.active === false) return c.json({ ok: false, reason: "automation off" });
    }

    const rawColor = typeof body.color === "string" ? body.color : "#FFCC00";
    const color = /^#[0-9A-Fa-f]{6}$/.test(rawColor) ? rawColor : "#FFCC00";
    const rawGroupId = typeof body.group_id === "string" ? body.group_id : "";
    const targetGroup = /^[a-zA-Z0-9_-]+$/.test(rawGroupId) ? rawGroupId : groupId;

    const xy = hexToXy(color);

    // 1. Try Remote API.
    const token = await getRemoteToken(integration);
    if (token) {
        try {
            const base = `https://api.meethue.com/route/clip/v2/resource/grouped_light/${targetGroup}`;
            const headers = { "Authorization": `Bearer ${token}`, "hue-application-key": appKey, "Content-Type": "application/json" };

            const stateRes = await fetch(base, { headers });
            const state = await stateRes.json() as { data?: Array<{ on?: { on?: boolean }; color?: { xy?: XY }; dimming?: { brightness?: number } }> };
            const current = state.data?.[0];
            if (current?.on?.on !== true) return c.json({ ok: false, reason: "lights off" });

            // Snapshot original only on first trigger (before any restore timer fires).
            if (!origXySnapshot) {
                origXySnapshot = current.color?.xy ?? { x: 0.3127, y: 0.3290 };
                origBrightnessSnapshot = current.dimming?.brightness ?? 100;
            }

            await fetch(base, { method: "PUT", headers, body: JSON.stringify({ color: { xy } }) });

            // Ambient mode - hold color indefinitely, no restore.
            if (mode !== "ambient") scheduleRestore(targetGroup, "remote", token, bridgeIp, appKey);
            return c.json({ ok: true, via: "remote", mode, color, xy, restoreIn: mode === "ambient" ? null : RESTORE_DELAY });
        } catch (e) {
            return c.json({ ok: false, via: "remote-error", error: e instanceof Error ? e.message : "remote fetch failed" }, 500);
        }
    }

    // 2. Fallback: local bridge.
    if (!bridgeIp) return c.json({ ok: false, error: "No remote token and no bridge_ip configured" }, 503);
    try {
        const state = await localFetch(bridgeIp, appKey, `/clip/v2/resource/grouped_light/${targetGroup}`);
        const current = state?.data?.[0];
        if (current?.on?.on !== true) return c.json({ ok: false, reason: "lights off" });

        if (!origXySnapshot) {
            origXySnapshot = current?.color?.xy ?? { x: 0.3127, y: 0.3290 };
            origBrightnessSnapshot = current?.dimming?.brightness ?? 100;
        }

        await localFetch(bridgeIp, appKey, `/clip/v2/resource/grouped_light/${targetGroup}`, "PUT", { color: { xy } });

        if (mode !== "ambient") scheduleRestore(targetGroup, "local", null, bridgeIp, appKey);
        return c.json({ ok: true, via: "local", mode, color, xy, restoreIn: mode === "ambient" ? null : RESTORE_DELAY });
    } catch (e) {
        return c.json({ ok: false, error: e instanceof Error ? e.message : "local fetch failed" }, 500);
    }
});

hue.delete("/hue/trigger", async (c: Context): Promise<Response> => {
    if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

    const xy = origXySnapshot ?? { x: 0.3127, y: 0.3290 };
    const bri = origBrightnessSnapshot ?? 100;
    origXySnapshot = null;
    origBrightnessSnapshot = null;

    const integration = await loadIntegration();
    if (!integration) return c.json({ ok: false, error: "No active Hue integration" }, 503);

    const appKey = integration.config?.app_key?.trim();
    const groupId = integration.config?.group_id?.trim();
    if (!appKey || !groupId) return c.json({ ok: false, error: "Hue not configured" }, 503);

    const token = await getRemoteToken(integration);
    try {
        if (token) {
            const base = `https://api.meethue.com/route/clip/v2/resource/grouped_light/${groupId}`;
            const headers = { "Authorization": `Bearer ${token}`, "hue-application-key": appKey, "Content-Type": "application/json" };
            await fetch(base, { method: "PUT", headers, body: JSON.stringify({ color: { xy }, dimming: { brightness: bri } }) });
            return c.json({ ok: true, via: "remote", restored: { xy, bri } });
        }
        const bridgeIp = integration.config?.bridge_ip?.trim();
        if (!bridgeIp) return c.json({ ok: false, error: "No bridge IP" }, 503);
        await localFetch(bridgeIp, appKey, `/clip/v2/resource/grouped_light/${groupId}`, "PUT", { color: { xy }, dimming: { brightness: bri } });
        return c.json({ ok: true, via: "local", restored: { xy, bri } });
    } catch (e) {
        return c.json({ ok: false, error: e instanceof Error ? e.message : "restore failed" }, 500);
    }
});

interface HueParent {
    metadata?: { name?: string };
    type?: string;
    services?: Array<{ rtype?: string; rid?: string }>;
}
interface HueListResponse<T> { data?: T[] }
interface HueGroupedLight { id: string; metadata?: { name?: string }; type?: string }

// In Hue v2, grouped_light resources don't carry their own name; the name
// lives on the parent room/zone that owns a service of type "grouped_light".
function buildGroupNameMap(rooms: HueListResponse<HueParent> | undefined, zones: HueListResponse<HueParent> | undefined): Map<string, { name: string; parentType: string }> {
    const map = new Map<string, { name: string; parentType: string }>();
    for (const parent of [...(rooms?.data ?? []), ...(zones?.data ?? [])]) {
        const name = parent.metadata?.name;
        const parentType = parent.type;
        if (!name || !parentType) continue;
        for (const svc of parent.services ?? []) {
            if (svc.rtype === "grouped_light" && svc.rid) map.set(svc.rid, { name, parentType });
        }
    }
    return map;
}

hue.get("/hue/groups", async (c: Context): Promise<Response> => {
    const integration = await loadIntegration();
    if (!integration) return c.json({ error: "No active Hue integration found" }, 503);

    const appKey = integration.config?.app_key?.trim();
    const bridgeIp = integration.config?.bridge_ip?.trim();
    if (!appKey) return c.json({ error: "app_key not configured" }, 503);

    // 1. Try Remote API.
    const token = await getRemoteToken(integration);
    if (token) {
        try {
            const headers = { "Authorization": `Bearer ${token}`, "hue-application-key": appKey };
            const [glRes, roomRes, zoneRes] = await Promise.all([
                fetch("https://api.meethue.com/route/clip/v2/resource/grouped_light", { headers }),
                fetch("https://api.meethue.com/route/clip/v2/resource/room", { headers }),
                fetch("https://api.meethue.com/route/clip/v2/resource/zone", { headers }),
            ]);
            const [glJson, roomJson, zoneJson] = await Promise.all([
                glRes.json() as Promise<HueListResponse<HueGroupedLight>>,
                roomRes.json() as Promise<HueListResponse<HueParent>>,
                zoneRes.json() as Promise<HueListResponse<HueParent>>,
            ]);
            const nameMap = buildGroupNameMap(roomJson, zoneJson);
            const groups = (glJson.data ?? []).map((g) => {
                const entry = nameMap.get(g.id);
                return { id: g.id, name: entry?.name ?? g.metadata?.name ?? "All lights", type: entry?.parentType ?? g.type ?? "grouped_light" };
            });
            return c.json({ groups, via: "remote" });
        } catch (e) {
            return c.json({ error: e instanceof Error ? e.message : "remote fetch failed" }, 500);
        }
    }

    // 2. Fallback: local bridge.
    if (!bridgeIp) return c.json({ error: "No remote token and no bridge_ip configured" }, 503);
    try {
        const [glJson, roomJson, zoneJson] = await Promise.all([
            localFetch(bridgeIp, appKey, "/clip/v2/resource/grouped_light") as Promise<HueListResponse<HueGroupedLight>>,
            localFetch(bridgeIp, appKey, "/clip/v2/resource/room") as Promise<HueListResponse<HueParent>>,
            localFetch(bridgeIp, appKey, "/clip/v2/resource/zone") as Promise<HueListResponse<HueParent>>,
        ]);
        const nameMap = buildGroupNameMap(roomJson, zoneJson);
        const groups = (glJson.data ?? []).map((g) => {
            const entry = nameMap.get(g.id);
            return { id: g.id, name: entry?.name ?? g.metadata?.name ?? "All lights", type: entry?.parentType ?? g.type ?? "grouped_light" };
        });
        return c.json({ groups, via: "local" });
    } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : "local fetch failed" }, 500);
    }
});
