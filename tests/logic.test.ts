/**
 * The decisions that change what a note becomes. Node's own test runner, so the
 * suite adds no dependency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectType, fuzzyMatchFolder, PATCH_ALLOWED_COLS, RAW_INSERT_ALLOWED_COLS } from "../src/notes/helpers.ts";
import { deriveTitle, splitRawText } from "../src/notes/title.ts";
import { expandCompactArray } from "../src/notes/batch.ts";
import { isReservedFolderName, remapReservedFolderPath } from "../src/lib/reserved-folders.ts";
import { hashLockPassword, verifyLockPassword, signUnlockCookie, verifyUnlockCookie } from "../src/lib/lock-password.ts";
import { livePayload } from "../src/lib/live-payload.ts";

test("detectType reads the content, then the filename", () => {
    assert.equal(detectType('{"a":1}'), "json");
    assert.equal(detectType("{not json"), "text");
    assert.equal(detectType("console.log(1)", "run.js"), "javascript");
    assert.equal(detectType("SELECT 1", "q.sql"), "sql");
    assert.equal(detectType("<!DOCTYPE html><html>"), "html");
    assert.equal(detectType("[ ] buy milk\n[x] done"), "checklist");
    assert.equal(detectType("just words"), "text");
    // An unparseable body must not be typed by its opening brace.
    assert.equal(detectType("[1,2", "notes.txt"), "text");
});

test("deriveTitle prefers frontmatter, then a heading, then the first line", () => {
    assert.equal(deriveTitle("", "---\ntitle: From Frontmatter\n---\nbody"), "From Frontmatter");
    assert.equal(deriveTitle("", "## A Heading\nbody"), "A Heading");
    assert.equal(deriveTitle("", "plain first line\nsecond"), "plain first line");
    assert.equal(deriveTitle("Untitled", "# Real Title"), "Real Title");
    assert.equal(deriveTitle("Given", "# Ignored"), "Given");
    assert.equal(deriveTitle("", ""), "Untitled");
    assert.equal(deriveTitle("", "x".repeat(200)).length, 80);
});

test("splitRawText lifts the h1 out of the body", () => {
    const a = splitRawText("intro\n# The Title\nbody");
    assert.equal(a.title, "The Title");
    assert.equal(a.content, "intro\nbody");
    const b = splitRawText("no heading here\nmore");
    assert.equal(b.title, "no heading here");
    assert.equal(b.content, "no heading here\nmore");
});

test("fuzzyMatchFolder resolves exact before loose", () => {
    const folders = [{ folder_name: "Jobs" }, { folder_name: "Job Search" }, { folder_name: "CLAUDE" }];
    assert.equal(fuzzyMatchFolder(folders, "jobs")?.folder_name, "Jobs");
    assert.equal(fuzzyMatchFolder(folders, "job-search")?.folder_name, "Job Search");
    assert.equal(fuzzyMatchFolder(folders, "clau")?.folder_name, "CLAUDE");
    assert.equal(fuzzyMatchFolder(folders, "zzzz"), undefined);
});

test("reserved view names never become folders", () => {
    for (const n of ["Today", "today", "Yesterday", "All"]) assert.equal(isReservedFolderName(n), true);
    assert.equal(isReservedFolderName("Todo"), false);
    assert.equal(remapReservedFolderPath("Today"), "CLAUDE");
    assert.equal(remapReservedFolderPath("Today/PM2026"), "CLAUDE/PM2026");
    assert.equal(remapReservedFolderPath("Work/Today"), "Work/Today");
});

test("compact array expands to the batch shape", () => {
    const [note, folder] = expandCompactArray([
        ["note", "T", "C", "Work", "#FF3B30"],
        ["folder", "New", "#00C7BE", "CLAUDE"],
    ]);
    assert.deepEqual(note, { type: "note", title: "T", content: "C", folder_name: "Work", color: "#FF3B30" });
    assert.deepEqual(folder, { type: "folder", name: "New", color: "#00C7BE", parent_folder: "CLAUDE" });
    // A note with no folder lands in CLAUDE rather than an empty string.
    assert.equal(expandCompactArray([["note", "T", "C"]])[0]!.folder_name, "CLAUDE");
});

test("column whitelists keep the dangerous fields out", () => {
    for (const col of ["user_id", "id", "created_by_key", "lock_password"]) {
        assert.equal(PATCH_ALLOWED_COLS.has(col), false, `${col} must not be patchable`);
    }
    assert.equal(PATCH_ALLOWED_COLS.has("lock_password_hash"), true, "set by the server after hashing");
    assert.equal(RAW_INSERT_ALLOWED_COLS.has("user_id"), false, "scoped from the caller, never the body");
    assert.equal(RAW_INSERT_ALLOWED_COLS.has("is_public"), false, "sharing is not a create-time field");
});

test("lock passwords hash, verify and reject", async () => {
    const hash = await hashLockPassword("hunter2");
    assert.match(hash, /^[0-9a-f]{32}\$[0-9a-f]{64}$/);
    assert.equal(await verifyLockPassword("hunter2", hash), true);
    assert.equal(await verifyLockPassword("wrong", hash), false);
    assert.equal(await verifyLockPassword("hunter2", null), false);
    assert.equal(await verifyLockPassword("hunter2", "garbage"), false);
    // The same password hashes differently every time, so the salt is real.
    assert.notEqual(hash, await hashLockPassword("hunter2"));
});

test("an unlock cookie is bound to the note and to the current password", () => {
    const hash = "abc123";
    const token = signUnlockCookie("note-1", hash);
    assert.equal(verifyUnlockCookie("note-1", hash, token), true);
    assert.equal(verifyUnlockCookie("note-2", hash, token), false, "another note must not be unlocked");
    assert.equal(verifyUnlockCookie("note-1", "rotated", token), false, "rotating the password kills old cookies");
    assert.equal(verifyUnlockCookie("note-1", hash, undefined), false);
});

test("livePayload drops the body only when the row is too big to send", () => {
    const small = { id: "1", content: "short", doc: null };
    assert.deepEqual(livePayload(small), small);
    const big = livePayload({ id: "1", title: "Report", content: "x".repeat(20_000), doc: { a: 1 } }) as Record<string, unknown>;
    assert.equal(big.content_omitted, true);
    assert.equal("content" in big, false);
    assert.equal("doc" in big, false);
    assert.equal(big.title, "Report", "the tile still renders from what is left");
});
