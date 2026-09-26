/**
 * The single database-access seam. Every route imports query/queryOne/execute
 * from HERE. Ported from the Next.js app unchanged so the SQL, the pool limits,
 * and the TLS posture stay identical.
 */
import pg from "pg";
import { env } from "./env.ts";

let pool: pg.Pool | null = null;
let warnedNoCa = false;

/**
 * Local (@localhost) connections use no TLS. For a remote DB, when
 * DATABASE_CA_CERT is supplied (raw PEM or base64) the server certificate is
 * VERIFIED. Without it production refuses to connect at all; everywhere else
 * logs a one-time warning so local work is never blocked by a missing CA.
 */
export function sslConfig(isRemote: boolean): false | { ca?: string; rejectUnauthorized: boolean } {
    if (!isRemote) return false;
    const raw = env.databaseCaCert;
    if (raw) {
        const ca = raw.includes("BEGIN CERTIFICATE") ? raw : Buffer.from(raw, "base64").toString("utf8");
        return { ca, rejectUnauthorized: true };
    }
    if (env.isProd) {
        throw new Error(
            "DATABASE_CA_CERT is required in production: refusing to open an unverified TLS connection to Postgres."
        );
    }
    if (!warnedNoCa) {
        warnedNoCa = true;
        console.warn("[db] DATABASE_CA_CERT not set - remote DB TLS certificate is NOT verified.");
    }
    return { rejectUnauthorized: false };
}

export function getPool(): pg.Pool {
    if (!pool) {
        pool = new pg.Pool({
            connectionString: env.databaseUrl,
            ssl: sslConfig(!env.databaseUrl.includes("@localhost")),
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000,
        });
    }
    return pool;
}

export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await getPool().query(sql, params);
    return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await getPool().query(sql, params);
    return (result.rows[0] as T) ?? null;
}

export async function execute(sql: string, params?: unknown[]): Promise<number> {
    const result = await getPool().query(sql, params);
    return result.rowCount ?? 0;
}

export async function closePool(): Promise<void> {
    if (pool) { await pool.end(); pool = null; }
}
