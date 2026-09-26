// Pure formatting helpers for the notes API — unit-tested.

const PALETTE = [
    "#FF3B30", "#FF6B4E", "#FF9500", "#FFCC00",
    "#D4E157", "#34C759", "#00C7BE", "#32ADE6",
    "#007AFF", "#5856D6", "#AF52DE", "#FF2D55",
];

export const COLOR_NAMES: Record<string, string> = {
    "#FF3B30": "red", "#FF6B4E": "coral", "#FF9500": "orange", "#FFCC00": "yellow",
    "#D4E157": "lime", "#34C759": "green", "#00C7BE": "teal", "#32ADE6": "sky blue",
    "#007AFF": "blue", "#5856D6": "indigo", "#AF52DE": "purple", "#FF2D55": "pink",
};

/** Friendly name for a palette hex; falls back to the hex itself. */
export function colorName(hex: string): string {
    return COLOR_NAMES[(hex || "").toUpperCase()] ?? hex;
}

/**
 * Strip emoji/pictographs from a title so API note titles stay clean text and
 * don't clash with the note's assigned icon. Removes pictographs, regional
 * indicators (flags), variation selectors, ZWJ, and keycap combiners; collapses
 * leftover whitespace.
 */
export function stripEmoji(s: string): string {
    return (s || "")
        .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// Strip HTML to plain text lines (shared by the client editor and the server API
// so a note previews and is titled/derived identically on both sides).
export function htmlToPlainLines(html: string): string {
    if (!/<[a-z][^>]*>/i.test(html)) return html;
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<li[^>]*>/gi, "")
        .replace(/<\/?(p|div|tr|dt|dd|h[1-6])[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// First N cleaned, truncated content lines for a note preview (the OG share-card
// silhouette). Strips HTML to text, drops leading markdown markers (#, -, >, 1.)
// and blank lines, and truncates each line so the preview reflects the real note
// shape without overflowing. Pure - caller must gate on is_public before passing content.
export function ogPreviewLines(content: string, maxLines = 5, maxLen = 52): string[] {
    const text = htmlToPlainLines(content || "");
    const out: string[] = [];
    for (const raw of text.split("\n")) {
        const line = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s+|\d+\.\s+)/, "").trim();
        if (!line) continue;
        out.push(line.length > maxLen ? line.slice(0, maxLen - 1) + "..." : line);
        if (out.length >= maxLines) break;
    }
    return out;
}

// Content sniffing: is the text a JSON object/array?
export function detectJson(text: string): { ok: boolean; parsed?: unknown } {
    const t = text.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return { ok: false };
    try { return { ok: true, parsed: JSON.parse(t) }; } catch { return { ok: false }; }
}

// Best-effort note type from its content (json / html / text). Markdown was dropped
// (2026-07-27): notes are plain text or HTML now.
export function detectNoteType(content: string): string {
    const t = content.trim();
    if (!t) return "text";
    if ((t.startsWith("{") || t.startsWith("[")) && detectJson(t).ok) return "json";
    if (/^\s*<!DOCTYPE\s+html/i.test(t) || /^\s*<html[\s>]/i.test(t)) return "html";
    return "text";
}

export { PALETTE };
