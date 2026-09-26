/**
 * Search. Two paths: a skill-scoped one, and a general separator-agnostic one.
 *
 * With this many *-audit skills writing notes, a bare "audit" match is noise.
 * When the query IS a known skill name - any separator, or none ("pr audit" /
 * "pr-audit" / "praudit") - only that skill's notes come back, identified by the
 * tile icon OR the "/<skill>" content chip, which is the ground truth of which
 * skill generated the note.
 */
import type { Context } from "hono";
import { query } from "../db.ts";
import { TABLE, withUser, SEARCH_COLS } from "./helpers.ts";

const SKILLS: { norm: string; icon: string; chip: string }[] = [
    { norm: "portfolioaudit", icon: "__portfolioaudit", chip: "portfolio-audit" },
    { norm: "githubaudit",    icon: "__githubaudit",    chip: "github-audit" },
    { norm: "repoaudit",      icon: "__repoaudit",      chip: "repo-audit" },
    { norm: "githubstats",    icon: "__githubstats",    chip: "github-stats" },
    { norm: "praudit",        icon: "__praudit",        chip: "(zeta-)?pr-audit" },
    { norm: "reporecon",      icon: "__reporecon",      chip: "repo-recon" },
    { norm: "securityaudit",  icon: "__securityaudit",  chip: "security-audit" },
    { norm: "epicaudit",      icon: "__epicaudit",      chip: "(zeta-)?epic-audit" },
    { norm: "devaudit",       icon: "__devaudit",       chip: "dev-audit" },
    { norm: "projectaudit",   icon: "__projectaudit",   chip: "project-(audit|recon)" },
    { norm: "storageaudit",   icon: "__storageaudit",   chip: "storage-audit" },
    { norm: "resourceaudit",  icon: "__resourceaudit",  chip: "resource-audit" },
];

const LIVE = `is_folder = false AND trashed_at IS NULL AND (folder_name IS DISTINCT FROM 'TRASH')`;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Treat spaces and dashes as interchangeable, so "repo recon" finds "repo-recon". */
const separatorAgnostic = (s: string): string => escapeRe(s).replace(/[\s-]+/g, "[-\\s]+");

export async function skillScopedSearch(c: Context, q: string, userId: string) {
    const words = q.split(/\s+/);

    // Consume a LEADING skill name (up to 3 words, any separator) and treat the
    // rest as an extra filter: "repo audit bunlongheng" is repo-audit notes
    // filtered to bunlongheng. No trailing term means the whole skill.
    let skill: (typeof SKILLS)[number] | undefined;
    let filterText = "";
    for (let take = Math.min(3, words.length); take >= 1; take--) {
        const head = words.slice(0, take).join("").toLowerCase().replace(/[^a-z0-9]/g, "");
        const found = SKILLS.find((s) => s.norm === head);
        if (found) { skill = found; filterText = words.slice(take).join(" ").trim(); break; }
    }

    if (skill) {
        const params: unknown[] = [skill.icon, `class="chip"[^>]*>\\s*/${skill.chip}`];
        const conds = [`(icon = $1 OR content ~* $2)`];
        if (filterText) {
            // Filter on the TITLE only. Nearly every audit report mentions
            // "stickies" or "github" in its body, so a content filter would match
            // the whole skill back again.
            params.push(separatorAgnostic(filterText));
            conds.push(`title ~* $${params.length}`);
        }
        const { sql, params: p } = withUser(
            `SELECT ${SEARCH_COLS} FROM ${TABLE} WHERE ${LIVE} AND ${conds.join(" AND ")}`, params, userId
        );
        const notes = await query(`${sql} ORDER BY updated_at DESC LIMIT 50`, p);
        return c.json({ notes, query: q, skill: skill.icon, filter: filterText || undefined });
    }

    const { sql, params } = withUser(
        `SELECT ${SEARCH_COLS} FROM ${TABLE} WHERE ${LIVE} AND (title ~* $1 OR content ~* $1)`,
        [separatorAgnostic(q)], userId
    );
    return c.json({ notes: await query(`${sql} ORDER BY updated_at DESC LIMIT 50`, params), query: q });
}
