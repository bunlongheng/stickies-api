/** Derive a usable title when the caller sent none, or the placeholder "Untitled". */
const CAP = 80;

export function deriveTitle(given: string, content: string): string {
    let title = given;
    if (title && title.toLowerCase() !== "untitled") return title;

    // 1. YAML frontmatter `title:`.
    const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const fmTitle = frontmatter?.[1]?.match(/^title:\s*(.+)$/m)?.[1];
    if (fmTitle) title = fmTitle.trim().slice(0, CAP);

    // 2. First markdown heading.
    if (!title || title.toLowerCase() === "untitled") {
        const heading = content.match(/^#{1,6}\s+(.+)$/m)?.[1];
        if (heading) title = heading.trim().slice(0, CAP);
    }

    // 3. First non-blank, non-delimiter line.
    if (!title || title.toLowerCase() === "untitled") {
        const first = content.trim().split("\n").find((l) => l.trim() && !l.startsWith("---")) ?? "";
        title = first.replace(/^#+\s*/, "").slice(0, CAP).trim() || "Untitled";
    }
    return title;
}

/** Split a raw markdown body into a title and the remaining content. */
export function splitRawText(raw: string): { title: string; content: string } {
    const lines = raw.split("\n");
    const h1 = lines.findIndex((l) => /^#\s+/.test(l));
    if (h1 !== -1) {
        return {
            title: lines[h1]!.replace(/^#\s+/, "").trim(),
            content: [...lines.slice(0, h1), ...lines.slice(h1 + 1)].join("\n").trim(),
        };
    }
    const firstLine = lines.find((l) => l.trim()) ?? "";
    return { title: firstLine.replace(/^#+\s*/, "").trim() || "Untitled", content: raw.trim() };
}
