/**
 * API-key generation + hashing. Pure and dependency-free (node crypto only).
 *
 * Keys are high-entropy random tokens, so a plain sha-256 is the right fit
 * (bcrypt is for low-entropy passwords). The plaintext is shown ONCE on create;
 * only the hash + a display prefix are ever persisted.
 */
import crypto from "crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Encode raw bytes into a base62 string (no padding, URL-safe). */
function toBase62(bytes: Buffer): string {
    let out = "";
    for (const b of bytes) out += BASE62[b % 62];
    return out;
}

/** sha-256 hex of the plaintext key. Deterministic. */
export function hashApiKey(plaintext: string): string {
    return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Generate a new API key.
 * - plaintext: `sk_` + 32 bytes of base62 entropy
 * - prefix: first 12 chars of the plaintext (for display, e.g. `sk_a1b2c3d4`)
 * - hash: sha-256 hex of the plaintext
 */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
    const plaintext = "sk_" + toBase62(crypto.randomBytes(32));
    return {
        plaintext,
        hash: hashApiKey(plaintext),
        prefix: plaintext.slice(0, 12),
    };
}
