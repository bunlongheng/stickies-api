import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { env, assertEnv } from "./env.ts";
import { closePool } from "./db.ts";

assertEnv();

const server = serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
    console.log(`stickies-api listening on http://localhost:${info.port} (${env.nodeEnv})`);
});

// Finish in-flight requests and hand back the pool rather than dropping both.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        server.close(async () => { await closePool(); process.exit(0); });
    });
}
