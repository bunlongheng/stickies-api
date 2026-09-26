// "Today" / "Yesterday" are virtual, time-based views (a group-by of notes by recency),
// never real storage folders. They must never be persisted as a folder row or assigned
// as a note's folder. This is the single source of truth, enforced at every write
// boundary (client create/rename + all API routes) and backed by a DB CHECK constraint.
export const RESERVED_VIEW_NAMES = ["Today", "Yesterday", "All"] as const;

export function isReservedFolderName(name?: string | null): boolean {
    if (!name) return false;
    const n = name.trim().toLowerCase();
    return RESERVED_VIEW_NAMES.some((r) => r.toLowerCase() === n);
}

// Remap a folder path whose leading segment is a reserved view to the default home:
// "Today" -> "CLAUDE", "Today/PM2026" -> "CLAUDE/PM2026". Used on note assignment so AI
// notes that aim at a virtual view land in the real default folder instead.
export function remapReservedFolderPath(folderName: string, fallback = "CLAUDE"): string {
    if (!folderName) return folderName;
    const parts = folderName.split("/");
    if (isReservedFolderName(parts[0])) parts[0] = fallback;
    return parts.join("/");
}
