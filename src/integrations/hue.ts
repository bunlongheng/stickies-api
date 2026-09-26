/**
 * Philips Hue flash on a new note from an agent.
 *
 * The bridge is reachable only from the machine on the home LAN, so this posts
 * to the local Hue service rather than talking to the bridge here. Two gates
 * before it fires: the process must not be a cloud deployment, and the
 * note_created -> hue_flash automation must still be switched on. Every
 * outcome is written to automation_logs, success and failure alike.
 */
import { queryOne, execute } from "../db.ts";
import { env } from "../env.ts";

const AUTOMATION_ID = "0f3b671c-95a1-4b4e-b59c-ffd2ed3de7e9";
const AUTOMATION_NAME = "Note Created -> Hue Flash";

function log(result: "ok" | "error", detail: string, color: string): void {
    execute(
        `INSERT INTO automation_logs (automation_id, automation_name, triggered_at, result, detail, via, trigger_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [AUTOMATION_ID, AUTOMATION_NAME, new Date().toISOString(), result, detail, "ext-api", JSON.stringify({ color })]
    ).catch(() => {});
}

export async function flashOnNewNote(color: string): Promise<void> {
    if (env.isProd && !env.lanTrust) return;
    try {
        const automation = await queryOne<{ active: boolean }>(
            `SELECT active FROM automations WHERE trigger_type = 'note_created' AND action_type = 'hue_flash'
             ORDER BY created_at LIMIT 1`
        );
        if (automation?.active === false) return;
    } catch { /* table missing: fall through and let the Hue service decide */ }

    try {
        const res = await fetch(`${env.hueInternalBaseUrl.replace(/\/$/, "")}/api/hue/trigger`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color, source: "note_created" }),
        });
        if (!res.ok) { log("error", `HTTP ${res.status}`, color); return; }
        const via = ((await res.json().catch(() => ({}))) as { via?: string }).via ?? "unknown";
        log("ok", `${color} via ${via}`, color);
    } catch (err) {
        log("error", err instanceof Error ? err.message : "fetch failed", color);
    }
}
