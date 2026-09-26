/**
 * Keeps openapi.yaml honest.
 *
 * A hand-written spec rots the moment a handler changes shape, and the clients
 * generated from it break quietly. These tests call the running service and
 * assert the real responses still match what the spec promises, so drift shows
 * up here instead of in Swift.
 *
 * Skipped when nothing is listening, so `npm test` still runs offline.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.env.API_BASE ?? "http://localhost:4446";
const spec = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");

// Resolved with a top-level await, not in a before() hook: node:test evaluates
// each `skip` when the test is DEFINED, so a hook would always read false.
const reachable = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
if (!reachable) console.log(`# no service on ${BASE}, contract tests skipped`);

/** Every property the spec declares on a schema, so responses can be checked against it. */
function declaredProperties(schemaName: string): string[] {
    const start = spec.indexOf(`    ${schemaName}:\n`);
    assert.notEqual(start, -1, `${schemaName} is missing from openapi.yaml`);
    const body = spec.slice(start).split(/\n    [A-Z]/)[0]!;
    const props = body.slice(body.indexOf("properties:"));
    return [...props.matchAll(/^        ([a-z_]+):/gm)].map((m) => m[1]!);
}

describe("openapi.yaml matches the running service", () => {
    test("Note schema covers every field a note actually returns", { skip: !reachable }, async () => {
        const res = await fetch(`${BASE}/notes?export=1`);
        assert.equal(res.status, 200);
        const { notes } = await res.json() as { notes: Record<string, unknown>[] };
        assert.ok(notes.length > 0, "need at least 1 note to check the shape");

        const declared = new Set(declaredProperties("Note"));
        const actual = new Set(notes.flatMap((n) => Object.keys(n)));
        const undocumented = [...actual].filter((k) => !declared.has(k));
        assert.deepEqual(undocumented, [], `these fields are returned but not in the spec: ${undocumented.join(", ")}`);
    });

    test("Folder schema covers every field a folder returns", { skip: !reachable }, async () => {
        const { folders } = await (await fetch(`${BASE}/notes?folders=1`)).json() as { folders: Record<string, unknown>[] };
        const declared = new Set(declaredProperties("Folder"));
        const undocumented = [...new Set(folders.flatMap((f) => Object.keys(f)))].filter((k) => !declared.has(k));
        assert.deepEqual(undocumented, [], `undocumented folder fields: ${undocumented.join(", ")}`);
    });

    test("counts returns the 5 keys the board reads", { skip: !reachable }, async () => {
        const body = await (await fetch(`${BASE}/notes?counts=1`)).json() as Record<string, unknown>;
        for (const key of ["counts", "countsByFolderId", "latestByFolderId", "total", "todayCount"]) {
            assert.ok(key in body, `counts response is missing ${key}`);
        }
        assert.equal(typeof body.total, "number");
        assert.equal(typeof body.todayCount, "number");
    });

    test("health reports the fields the spec declares", { skip: !reachable }, async () => {
        const body = await (await fetch(`${BASE}/health`)).json() as Record<string, unknown>;
        for (const key of ["ok", "db", "liveClients", "uptimeSec"]) assert.ok(key in body, `health is missing ${key}`);
    });

    test("a note read by id carries its body, a list does not", { skip: !reachable }, async () => {
        const { notes } = await (await fetch(`${BASE}/notes?recent=all&limit=1`)).json() as { notes: { id: string }[] };
        assert.ok(notes[0], "need a note");
        assert.equal("content" in notes[0], false, "list rows must stay slim, the grid does not render bodies");
        const { note } = await (await fetch(`${BASE}/notes?id=${notes[0].id}`)).json() as { note: Record<string, unknown> };
        assert.ok("content" in note, "reading one note must return its content");
    });

    test("an API key cannot delete and cannot manage keys", { skip: !reachable || !process.env.STICKIES_API_KEY }, async () => {
        const headers = { Authorization: `Bearer ${process.env.STICKIES_API_KEY}`, Host: "not-local.example" };
        const del = await fetch(`${BASE}/ext?id=00000000-0000-0000-0000-000000000000`, { method: "DELETE", headers });
        assert.equal(del.status, 403, "a leaked key must never be able to delete a note");
        assert.equal((await fetch(`${BASE}/keys`, { headers })).status, 403, "a machine key must not manage keys");
    });

    test("a private note is indistinguishable from a missing one", { skip: !reachable }, async () => {
        const res = await fetch(`${BASE}/public?noteId=00000000-0000-0000-0000-000000000000`);
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: "Not found" });
    });
});
