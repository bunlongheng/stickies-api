/**
 * The 1200x630 card that link previews show for a shared note.
 *
 * The Next.js version used next/og, which is a whole framework runtime for one
 * fixed card. This builds the SVG directly and rasterizes it, so the only cost
 * is the renderer. Satori is not needed: nothing here needs flexbox, the layout
 * is 6 absolutely-placed elements.
 */
import { Hono } from "hono";
import { Resvg } from "@resvg/resvg-js";
import { queryOne } from "../db.ts";
import { ogPreviewLines } from "../lib/note-format.ts";
import { escapeHtml } from "../lib/share-html.ts";

export const og = new Hono();

const W = 1200, H = 630, BG = "#0f0f10", FG = "#f5f5f7", MUTED = "#8e8e93";
const DEFAULT_COLOR = "#facc15";
/** Ghost bars stand in when a note has no previewable body. */
const FALLBACK_BARS = [760, 900, 640, 820, 520];

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

function card(title: string, details: string[], color: string, body: string[], locked: boolean): string {
    const safeTitle = escapeHtml(locked ? truncate(title, 80) : truncate(title, 140));
    const titleSize = locked ? (title.length > 38 ? 40 : 52) : (title.length > 60 ? 62 : 78);

    // Wrap on width, not on character count: at 78px roughly 26 characters fit.
    const perLine = Math.floor(1000 / (titleSize * 0.52));
    const titleLines: string[] = [];
    let line = "";
    for (const word of safeTitle.split(" ")) {
        if ((line + " " + word).trim().length > perLine && line) { titleLines.push(line); line = word; }
        else line = (line + " " + word).trim();
        if (titleLines.length === 3) break;
    }
    if (line && titleLines.length < 3) titleLines.push(line);

    const titleSvg = titleLines
        .map((l, i) => `<text x="80" y="${210 + i * (titleSize + 12)}" fill="${FG}" font-size="${titleSize}" font-weight="700" font-family="Helvetica, Arial, sans-serif">${l}</text>`)
        .join("");
    const titleBottom = 210 + titleLines.length * (titleSize + 12);

    const bodySvg = locked ? "" : body.length
        ? body.map((l, i) => `<text x="80" y="${titleBottom + 30 + i * 38}" fill="${MUTED}" font-size="26" font-family="Helvetica, Arial, sans-serif">${escapeHtml(l)}</text>`).join("")
        : FALLBACK_BARS.map((w, i) => `<rect x="80" y="${titleBottom + 12 + i * 34}" width="${w}" height="14" rx="7" fill="#26262a"/>`).join("");

    const detailSvg = locked ? "" :
        `<text x="80" y="${H - 70}" fill="${MUTED}" font-size="26" font-family="Helvetica, Arial, sans-serif">${escapeHtml((details.length ? details : ["Shared note"]).join("  ·  "))}</text>`;

    const lockSvg = locked
        ? `<rect x="${W - 232}" y="64" width="152" height="52" rx="26" fill="${color}" opacity="0.18"/>
           <text x="${W - 156}" y="98" fill="${color}" font-size="24" font-weight="700" text-anchor="middle" font-family="Helvetica, Arial, sans-serif">LOCKED</text>`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <rect width="${W}" height="${H}" fill="${BG}"/>
        <rect x="0" y="0" width="14" height="${H}" fill="${color}"/>
        <circle cx="104" cy="104" r="24" fill="${color}"/>
        <text x="148" y="114" fill="${MUTED}" font-size="28" font-weight="600" font-family="Helvetica, Arial, sans-serif">Stickies</text>
        ${lockSvg}${titleSvg}${bodySvg}${detailSvg}
    </svg>`;
}

type OgRow = {
    title: string; is_public: boolean; folder_name: string | null; folder_color: string | null;
    type: string | null; updated_at: string; locked: boolean; content: string | null;
};

og.get("/public/og", async (c) => {
    const noteId = c.req.query("noteId");
    // A DB failure must still produce a card: a broken image is worse than a generic one.
    const row = noteId
        ? await queryOne<OgRow>(
            `SELECT title, is_public, folder_name, folder_color, type, updated_at, locked, content
             FROM "stickies" WHERE id = $1 AND trashed_at IS NULL`, [noteId]
        ).catch(() => null)
        : null;

    const isPublic = row?.is_public === true;
    const locked = row?.locked === true;
    const title = isPublic && row?.title ? row.title : "Stickies";
    const color = row?.folder_color && /^#[0-9a-f]{6}$/i.test(row.folder_color) ? row.folder_color : DEFAULT_COLOR;

    const details: string[] = [];
    if (isPublic && row) {
        if (row.folder_name) details.push(row.folder_name);
        if (row.type) details.push(row.type.toUpperCase());
        if (row.updated_at) {
            details.push(new Date(row.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
        }
    }
    // Body text is shown only for an unlocked public note, never for a locked one.
    const body = isPublic && !locked && row?.content ? ogPreviewLines(row.content) : [];

    const png = new Resvg(card(title, details, color, body, locked), {
        fitTo: { mode: "width", value: W },
        font: { loadSystemFonts: true },
    }).render().asPng();

    return c.body(new Uint8Array(png), 200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
    });
});
