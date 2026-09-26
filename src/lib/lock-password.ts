import { scrypt, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const SCRYPT_KEYLEN = 32;
const SALT_LEN = 16;

// Async scrypt: the KDF is deliberately CPU-heavy, so running it synchronously
// (scryptSync) on the public passcode gate lets a burst of guesses freeze the
// whole Node event loop (a trivial DoS). promisify(scrypt) runs it on libuv's
// threadpool instead, keeping the loop responsive under a flood of attempts.
const scryptAsync = promisify(scrypt) as (
    password: string | Buffer, salt: string | Buffer, keylen: number,
) => Promise<Buffer>;

/** Hash a plaintext password as `salt$scrypt(password, salt)` (hex). */
export async function hashLockPassword(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const key = await scryptAsync(plain, salt, SCRYPT_KEYLEN);
    return `${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time verify a plaintext password against a stored `salt$hash`. */
export async function verifyLockPassword(plain: string, stored: string | null): Promise<boolean> {
    if (!stored || !stored.includes("$")) return false;
    const [saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    try {
        const salt = Buffer.from(saltHex, "hex");
        const expected = Buffer.from(hashHex, "hex");
        const actual = await scryptAsync(plain, salt, expected.length);
        return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch { return false; }
}

/** HMAC token proving the holder unlocked `noteId` with the current password hash.
 *  Bound to both noteId and the hash, so rotating the password invalidates old cookies. */
export function signUnlockCookie(noteId: string, lockHash: string): string {
    const secret = process.env.AUTH_SECRET || process.env.STICKIES_API_KEY || "stickies-fallback-secret";
    return createHmac("sha256", secret).update(`${noteId}::${lockHash}`).digest("hex");
}

export function verifyUnlockCookie(noteId: string, lockHash: string, cookie: string | undefined): boolean {
    if (!cookie) return false;
    const expected = signUnlockCookie(noteId, lockHash);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(cookie, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
}

export function unlockCookieName(noteId: string): string {
    return `stickies_unlock_${noteId.replace(/[^a-z0-9-]/gi, "")}`;
}
