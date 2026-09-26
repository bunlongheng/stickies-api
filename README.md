# stickies-api

The HTTP API behind Stickies. `stickies-web` and `stickies-native` both call it;
neither talks to Postgres.

Split out of the Next.js app so a Swift client has a real contract to generate
against, and so realtime is a long-lived process holding its own connections
instead of a third party with a 10KB event cap.

**Related:** [`stickies`](../stickies/README.md) is the web app that consumes
this service. Its `lib/api-client.ts` is the seam, and one env var decides
whether it calls here or its own route handlers. See
[Connecting the web app](#connecting-the-web-app) below.

## Run

```bash
npm install
cp .env.example .env     # then fill it in
npm run dev              # watch mode on PORT, default 4446
npm test                 # unit + contract, no database needed for the unit half
npm run typecheck
```

Node 22.18 or newer. There is no build step and no bundler: `node
--experimental-strip-types` runs the TypeScript directly, and `tsconfig` sets
`erasableSyntaxOnly` so the compiler refuses anything that would need one.

## What it is made of

| | |
|---|---|
| Runtime deps | 6: `hono`, `@hono/node-server`, `pg`, `jose`, `pdf-parse`, `@resvg/resvg-js` |
| `node_modules` | 25 packages, 114MB (the Next.js app: 30 deps, 502 packages, 902MB) |
| Source | about 4300 lines across 50 files, 1000 of them libs moved over unchanged |
| Realtime | server-sent events, no Pusher |
| Auth | bearer only: an API key, or a JWT this service issues |

Nothing is here that a route does not import. That is the whole design rule.

`compare.html` is the side-by-side against the monolith, 19 rows, every figure
measured rather than recalled. Regenerate it with `python3 docs/gen-compare.py`
after re-measuring; do not hand-edit the table.

## Auth

Three ways in, resolved in this order by `src/auth/caller.ts`:

1. **Static `STICKIES_API_KEY`** bearer, timing-safe compared. The existing agents and scripts.
2. **A row in `api_keys`**, looked up by sha-256. Carries its own label, which becomes the note's attribution.
3. **An access JWT** from `/auth/google`. What the web app and the native app hold.
4. **LAN trust**, keyless, for local development and the hub. Off in production unless `STICKIES_LAN_TRUST=1`.

`stickies-native` could not use the old NextAuth cookie sessions, so it had no
real auth at all. Now both clients do the same thing: run Google sign-in, POST
the `id_token` to `/auth/google`, and hold a 15-minute access token plus a
60-day refresh token. The id_token is verified against Google's public keys with
the audience pinned to our client id, so no client ships a secret.

Two rules are enforced at the routing layer, not inside a handler:

- **No API key can delete.** Any keyed caller gets 403 on DELETE. A leaked key cannot destroy notes.
- **No machine key can manage keys.** Only a person's session reaches `/keys`.

## Endpoints

`/notes` and `/ext` are the same handlers. `/ext` exists because the automations
already point there.

| Path | |
|---|---|
| `GET /notes` | 13 read modes on 1 path, by query param: `id`, `folder`, `since`, `q`, `recent`, `counts`, `folders`, `prefs`, `export`, `route`, `apikey` |
| `POST /notes` | JSON, raw markdown, a batch of 500, the compact array form, `?raw=1`, or `?type=folder` |
| `PATCH /notes` | single, batch `updates`, `rename_note`, `rename_folder`, `merge_folder`, `pinned_folders` |
| `DELETE /notes` | by `id` or by empty `folder_name` |
| `GET /live` | SSE: `note-created`, `note-updated`, `note-deleted`, `api-request` |
| `POST /auth/google`, `/auth/refresh` | token issue and renew |
| `/public`, `/share`, `/raw`, `/public/og` | public sharing, passcode gate, link-preview card |
| `/keys`, `/automations`, `/integrations`, `/backup`, `/folder-icon` | admin |
| `/gdrive`, `/upload`, `/ai`, `/hue/*` | integrations |

`openapi.yaml` covers the client surface. Point `swift-openapi-generator` at it
for typed Swift models. `tests/contract.test.ts` calls the running service and
asserts real responses still match the spec, so drift fails a test instead of
breaking a client quietly.

## Connecting the web app

`stickies` ships pointed at its own route handlers. One variable moves it here:

```bash
# in ~/Sites/stickies/.env.local
NEXT_PUBLIC_STICKIES_API_BASE=http://localhost:4446
```

Unset, nothing changes and the app behaves exactly as it always has. That is the
default on purpose: with the flag on and this service down, the board is empty.

Everything client-side goes through `lib/api-client.ts`, which rewrites the path
(`/api/stickies` becomes `/notes`, `/api/stickies/keys` becomes `/keys`) and
attaches the bearer token. `fetchRetry` routes through the same seam, so its
call sites needed no edit. `/api/auth/*` is deliberately excluded: NextAuth owns
the sign-in pages and stays in the web app.

Realtime swaps with it. `lib/realtime-channel.ts` exposes one `bind`/`close`
interface over either transport, so the 200 lines of event-handling in
`useRealtimeSync` did not change: Pusher when the flag is off, an `EventSource`
against `/live` when it is on.

Verified end to end on 2026-09-22 with a real browser: 12 boot requests to this
service, 0 left going to the Next.js routes, SSE connected, a note POSTed to
`/ext` appearing with no reload, and a DELETE removing it the same way.

### Auth when it is connected

| Where | How it authenticates |
|---|---|
| localhost and LAN | Nothing to do. This service trusts local callers, same as the old app. |
| Production | The browser holds an access token from `/auth/google`; `apiFetch` sends it as a bearer. |
| The SSE stream | `EventSource` cannot set headers, so the token rides `?access_token=`. |

That query-string exception is scoped to `/live` and to access tokens only.
Every other path ignores a token in the URL and answers 401, because a URL gets
logged and referred in ways a header does not.

## Realtime

`GET /live` is server-sent events. `URLSession.bytes` reads it on Swift,
`EventSource` in a browser. A `ready` event on connect, a `ping` comment every
25 seconds so phone radios and proxies do not drop the connection.

An event over 8KB arrives with `content` and `doc` stripped and
`content_omitted: true` set; fetch the full row with `GET /notes?id=`. That
guard is kept from the Pusher era because it is still right for a 200KB audit
report on a phone, but it is no longer a hard cap: nothing rejects a large
event now, the slim row is a choice.

## Notes on the port

Behavior is matched deliberately, including the parts that look odd:

- **Fuzzy folder matching**, 4 passes. `job-search`, `Job Search` and `jobsearch` are one folder.
- **A missing sub-folder is created, a missing root is a 400.** Auto-creating roots is what filled the board with junk top-level folders.
- **Keyed callers upsert by title, owner posts always insert.** An agent re-posting a report updates it; a person writing a second note with the same title gets a second note.
- **`resurface`** bumps `created_at` on a keyed upsert, so a regenerated report rises to the top instead of staying buried where it was first written.
- **`Today`, `Yesterday` and `All` are virtual views**, never folder rows. A note aimed at one lands in `CLAUDE`.
- **`frozen` is a write-protect**: edits and deletes return 423, but sharing controls still work, so a frozen note stays publishable.

Three things were changed on purpose, each with a comment where it lives:

1. **`lock_password_hash` is no longer returned.** The old `SELECT *` handed the scrypt hash of a note's share passcode to every authenticated caller, keyed agents included, for all 11 notes that have one. Excluded from every read.
2. **The `/integrations/:id` PATCH body is parsed in a try/catch.** It threw a raw 500 on malformed JSON.
3. **PDF text extraction actually runs.** The old call shape did not match `pdf-parse` v2, so uploads silently stored empty text.

`googleapis` (about 100MB) and the Anthropic SDK were both replaced with direct
`fetch` calls against the same REST endpoints. The OG card is hand-built SVG
rather than a rendering framework: it is 6 absolutely-placed elements.

## Environment

See `.env.example`. `DATABASE_URL` and `AUTH_SECRET` are required and checked at
boot, not at first request. Remote Postgres verifies TLS when `DATABASE_CA_CERT`
is set, and production refuses to connect without it.
