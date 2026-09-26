/**
 * Realtime (Pusher) payload guard.
 *
 * Pusher rejects events over 10KB with HTTP 413. The API broadcast the full
 * note row, so every note bigger than that (773 of them: audits, cheat sheets,
 * reports) silently never arrived live. livePayload() drops the heavy body
 * fields from oversized rows and flags them; hydrateLive() on the client
 * fetches the full row by id when it sees the flag.
 */
const LIMIT = 8 * 1024; // headroom under Pusher's 10KB cap for the event envelope

export function livePayload<T extends Record<string, unknown>>(row: T): T | (Omit<T, "content" | "doc"> & { content_omitted: true }) {
    if (!row || JSON.stringify(row).length <= LIMIT) return row;
    const { content: _c, doc: _d, ...rest } = row;
    return { ...rest, content_omitted: true as const };
}
