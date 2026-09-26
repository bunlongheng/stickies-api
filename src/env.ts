/**
 * Every environment variable the service reads, resolved and validated once at
 * boot. A missing required var fails the process here rather than 500-ing the
 * first request that happens to need it.
 */
const optional = (name: string, fallback = ""): string => process.env[name]?.trim() || fallback;

/** Vars with no safe default. Validated at boot by assertEnv(), not at import. */
const REQUIRED = ["DATABASE_URL", "AUTH_SECRET"] as const;

/**
 * Called once from index.ts. Reading env at import time instead would make
 * every module - including the pure ones a unit test imports - refuse to load
 * without a database, which is the wrong trade for a fail-fast check.
 */
export function assertEnv(): void {
    const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
    if (missing.length) throw new Error(`Missing required env var: ${missing.join(", ")}`);
}

export const env = {
    nodeEnv: optional("NODE_ENV", "development"),
    isProd: optional("NODE_ENV") === "production",
    port: Number(optional("PORT", "4445")),

    databaseUrl: optional("DATABASE_URL"),
    databaseCaCert: optional("DATABASE_CA_CERT"),

    /** Signs and verifies the access/refresh JWTs issued to native + web clients. */
    authSecret: optional("AUTH_SECRET", "test-secret-not-for-production"),
    googleClientId: optional("GOOGLE_CLIENT_ID"),
    googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),

    ownerEmail: optional("OWNER_EMAIL").toLowerCase(),
    ownerUserId: optional("OWNER_USER_ID"),

    /** Shared static bearer. Kept for the existing automations; per-key rows are preferred. */
    staticApiKey: optional("STICKIES_API_KEY"),
    /** On a locked deployment only this api_keys label may authenticate. */
    prodKeyLabel: optional("STICKIES_PROD_KEY_LABEL", "claude-routine"),
    prodLocked: optional("STICKIES_PROD_LOCK") === "1",
    /** The M4 hub opts in so a production build serves LAN devices keyless. */
    lanTrust: optional("STICKIES_LAN_TRUST") === "1",

    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    hueInternalBaseUrl: optional("HUE_INTERNAL_BASE_URL", "http://127.0.0.1:4444"),
    githubBackupToken: optional("GITHUB_BACKUP_TOKEN"),
    /** No .next/BUILD_ID here (this is not Next.js) - set explicitly at deploy time instead. */
    buildId: optional("STICKIES_BUILD_ID"),

    appBaseUrl: optional("APP_BASE_URL", "http://localhost:4445"),
    /** Origins allowed to send credentialed browser requests. Comma separated. */
    corsOrigins: optional("CORS_ORIGINS", "http://localhost:3000,http://localhost:4444")
        .split(",").map((s) => s.trim()).filter(Boolean),
} as const;
