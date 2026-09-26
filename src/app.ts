import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.ts";
import { notes } from "./routes/notes.ts";
import { live } from "./routes/live.ts";
import { health } from "./routes/health.ts";
import { auth } from "./routes/auth.ts";
import { keys } from "./routes/keys.ts";
import { publicShare } from "./routes/public.ts";
import { og } from "./routes/og.ts";
import { local } from "./routes/local.ts";
import { backup } from "./routes/backup.ts";
import { automations } from "./routes/automations.ts";
import { integrations } from "./routes/integrations.ts";
import { folderIcon } from "./routes/folder-icon.ts";
import { misc } from "./routes/misc.ts";
import { ai } from "./routes/ai.ts";
import { hue } from "./routes/hue.ts";
import { gdrive } from "./routes/gdrive.ts";

export const app = new Hono();

// Credentialed browser requests come from the web app's own origin only. The
// public share routes set their own wide-open CORS, which is why they are not
// covered by this policy.
app.use("*", cors({
    origin: env.corsOrigins,
    allowHeaders: ["Content-Type", "Authorization", "X-Stickies-Machine"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Note-Title"],
    credentials: true,
}));

app.onError((err, c) => {
    console.error(`[${c.req.method} ${c.req.path}]`, err);
    return c.json({ error: env.isProd ? "Internal error" : err.message }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

for (const surface of [health, misc, auth, live, notes, keys, local, backup,
                       automations, integrations, folderIcon, ai, hue, gdrive,
                       publicShare, og]) {
    app.route("/", surface);
}
