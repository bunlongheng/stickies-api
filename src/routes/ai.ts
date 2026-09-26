/**
 * POST /ai - streams a note-assistant completion back as plain text.
 *
 * Ported from app/api/stickies/ai/route.ts. Calls the Anthropic REST API
 * directly with fetch instead of @anthropic-ai/sdk - the SDK is a heavy
 * dependency to pull in for the one streaming call this service makes, and
 * the wire format (SSE) is simple enough to parse by hand.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { stream } from "hono/streaming";
import { requireAuth } from "../auth/middleware.ts";
import { env } from "../env.ts";

const SYSTEM_PROMPT = "You are a note assistant inside a sticky-notes app. The user gives you an instruction about their note. Do exactly what they ask. Return ONLY the resulting note content - no preamble, no markdown fences, no commentary.";

interface AnthropicStreamEvent {
    type?: string;
    delta?: { type?: string; text?: string };
    error?: { message?: string };
}

export const ai = new Hono();
ai.use("*", requireAuth);

ai.post("/ai", async (c: Context): Promise<Response> => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const content = typeof body.content === "string" ? body.content : "";
    const title = typeof body.title === "string" ? body.title : "";
    if (!prompt.trim()) return c.text("Missing prompt", 400);
    if (!env.anthropicApiKey) return c.text("AI is not configured", 503);

    const userParts: string[] = [];
    if (title.trim()) userParts.push(`Title: ${title.trim()}`);
    if (content.trim()) userParts.push(`Current content:\n${content.trim()}`);
    userParts.push(`Instruction: ${prompt.trim()}`);

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": env.anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body: JSON.stringify({
            model: "claude-sonnet-5",
            max_tokens: 4096,
            stream: true,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userParts.join("\n\n") }],
        }),
    });

    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "no-cache");

    return stream(c, async (writer) => {
        // A mid-stream failure appends an error marker into the body rather
        // than changing the HTTP status - the client is already reading the
        // response as a stream by the time anything can go wrong here.
        if (!upstream.ok || !upstream.body) {
            // Pass the upstream message through. A bare status hides the actual
            // cause - an exhausted credit balance and a malformed request both
            // arrive as a 400, and they need completely different fixes.
            const detail = await upstream.text()
                .then((t) => (JSON.parse(t) as { error?: { message?: string } }).error?.message)
                .catch(() => null);
            await writer.write(`\n[Error: ${detail ?? `HTTP ${upstream.status}`}]`);
            return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const data = line.slice(6);
                    if (data === "[DONE]") continue;
                    let evt: AnthropicStreamEvent;
                    try { evt = JSON.parse(data) as AnthropicStreamEvent; } catch { continue; }
                    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
                        await writer.write(evt.delta.text);
                    } else if (evt.type === "error") {
                        await writer.write(`\n[Error: ${evt.error?.message ?? "stream error"}]`);
                    }
                }
            }
        } catch (e) {
            await writer.write(`\n[Error: ${e instanceof Error ? e.message : "stream failed"}]`);
        }
    });
});
