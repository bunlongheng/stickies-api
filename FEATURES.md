# Parity checklist

Every behavior the Next.js app exposes today. `stickies-api` is not done until
every row is `done` and has a test. Extracted by reading all 28 route files in
`~/Sites/stickies` on 2026-09-22, not from memory.

Status as of 2026-09-22, after the first build:

| | |
|---|---|
| Built and VERIFIED against the live database | every GET mode, auth, realtime, sharing, the delete and key-management guards |
| Built, typechecks, route answers, NOT yet exercised end to end | every WRITE path (POST, PATCH, DELETE), Drive OAuth, the Hue bridge, AI streaming |
| Evidence | 23 of 23 GET responses byte-identical to the running Next.js app, 17 of 17 tests pass |

Write paths are deliberately untested: this repo points at the real notes
database, and the project rule is to show the payload and get a yes before
POSTing to it. They are the next thing to run.

Legend: `done` verified with evidence / `built` written and typechecking, not exercised / `todo` / `drop`.

## Notes CRUD - `app/api/stickies/route.ts` (1383 loc, the core)

### GET, 12 distinct read modes on 1 path
| # | Mode | Trigger | Returns | Status |
|---|---|---|---|---|
| 1 | Prefs | `?prefs=1` | `{pinned_folders}` | done |
| 2 | API key reveal | `?apikey=1`, owner only, 403 otherwise | `{key}`, `Cache-Control: no-store` | done |
| 3 | Route lookup | `?route=<title>&folder=` | `{sticky}` | done |
| 4 | Folders only | `?folders=1` | `{folders}`, order asc, limit 2000 | done |
| 5 | Today | `?recent=today&days=1..30` | `{notes, days}`, 24h steps, limit 500 | done |
| 6 | All | `?recent=all&limit=1..100&offset=` | `{notes, total}`, ordered `created_at` | done |
| 7 | Counts | `?counts=1` | `{counts, countsByFolderId, latestByFolderId, total, todayCount}` | done |
| 8 | Folder delta | `?folder=X&since=<iso>` | `{notes, delta:true, syncedAt}` | done |
| 9 | Folder page | `?folder=X&limit=&offset=` | `{notes, total, syncedAt}` + task counts | done |
| 10 | Search | `?q=` incl. 12-skill scoped search + chained filter | `{notes, query, skill?, filter?}` | done |
| 11 | By id | `?id=` | `{note}` | done |
| 12 | Export | `?export=1` | `{notes, total}`, limit 500 | done |
| 13 | Default list | no params | `{notes}`, order asc, limit 500 | done |

Cross-cutting on GET:
- [x] TRASH auto-expire: delete `folder_name='TRASH' AND trashed_at < now()-7d`, throttled 1/hour/user, fire-and-forget
- [x] `task_count` / `task_done_count` / `task_remaining_count` computed in SQL for checklist notes (`[x]`=1, `[/]`=0.5)
- [x] `withUser()` parameterized user scoping on every query

### POST, 5 body shapes
| # | Shape | Trigger | Status |
|---|---|---|---|
| 1 | Single JSON note | default | built |
| 2 | Raw text/markdown | `Content-Type: text/plain\|markdown` + `?folder&color&type&icon` | built |
| 3 | Batch | `{batch:[...]}`, max 500, 1 multi-row INSERT + per-row fallback | built |
| 4 | Compact array | `[["note",title,content,folder,color],["folder",name,color,parent]]` | built |
| 5 | Raw insert | `?raw=1`, column whitelist | built |
| 6 | Folder create | `?type=folder` or `{type:"folder"}`, 409 on dup | built |

POST behaviors:
- [x] Title auto-derive: frontmatter `title:` -> first `#` heading -> first non-blank line, 80 char cap
- [x] `stripEmoji` on every title
- [x] Icon validation against `SUPPORTED_NOTE_ICONS`, 422 `unsupported_icon` with `how_to_fix` + full list
- [x] Icon auto-pick via `pickNoteIcon(title, content, type)` when absent
- [x] `detectType()`: json, ext-based (js/ts/py/css/sql/sh/html/json), doctype html, `[ ]` checklist, else text
- [x] Least-used color picker from `palette12`, separate pools for notes vs folders
- [x] Fuzzy folder match, 4 passes: exact ci -> normalized -> startsWith -> contains
- [x] Slash path resolve `A/B/C`, auto-creates missing sub-folders, rejects missing ROOT with 400
- [x] Non-browser callers (no `mozilla` UA) get unknown simple folders nested under `CLAUDE/`
- [x] External callers may not create root folders, forced parent `CLAUDE`
- [x] Reserved names `Today`/`Yesterday`/`All` remapped, never persisted
- [x] Upsert-by-title for external callers only; owner POST always INSERTs
- [x] `resurface` (default true) bumps `created_at` on ext upsert so re-posts rank new
- [x] Live event is `note-created` on resurface, `note-updated` otherwise
- [x] Attribution: `created_by_key` (apikey label / machine / `stickies`) + `created_by_machine`
- [x] Machine from `X-Stickies-Machine` header, sanitized `[A-Za-z0-9._-]` cap 64, else IP lookup
- [x] Response envelope `{ok, action, message, color, color_name, note}` with color NAME in prose
- [x] Hue flash on external POST only, gated on the `note_created`->`hue_flash` automation toggle

### PATCH, 6 body shapes
| # | Shape | Status |
|---|---|---|
| 1 | `{pinned_folders}` upsert into `user_preferences` | built |
| 2 | `{rename_note:{id,title}}`, 423 if frozen | built |
| 3 | `{rename_folder:{from,to}}`, updates folder row + all notes | built |
| 4 | `{merge_folder:{from,to}}`, moves notes then deletes folder, returns moved count | built |
| 5 | `{updates:[{id,...}]}` batch, skips frozen, returns `locked_skipped` | built |
| 6 | `{id, ...fields}` single | built |

PATCH behaviors:
- [x] `PATCH_ALLOWED_COLS` whitelist on BOTH single and batch paths (mass-assignment + SQL identifier injection guard)
- [x] External keys stripped of `is_public`, `locked`, `lock_password`, `lock_password_hash`
- [x] Frozen note: 423 unless the only fields are `frozen`/`is_public`/`locked`/`lock_password`
- [x] `lock_password` plaintext hashed to `lock_password_hash`; `locked:false` clears the hash
- [x] `doc` JSONB stringified before bind
- [x] Null RETURNING treated as success (no false "Save Failed")

### DELETE
- [x] API keys can NEVER delete, 403 for any external caller (prod data guard)
- [x] `?id=`, 423 if frozen
- [x] `?folder_name=`, 409 `folder_not_empty` with `note_count` unless TRASH
- [x] TRASH deletes notes inside only, never the folder row

## Auth
- [x] Accept order: static bearer (timing-safe) -> `api_keys` sha-256 -> LAN trust -> session
- [x] `api_keys` lookup bumps `last_used_at` fire-and-forget, `revoked_at IS NULL` only
- [x] Prod lockdown: only the `claude-routine` label passes; shared static key rejected
- [x] LAN trust only off-prod, or on the hub with `STICKIES_LAN_TRUST=1`
- [x] `/api/stickies` rejects the static key with a 403 that names `/ext` (route split)
- [x] `/ext` is the same handlers, keyed callers only
- [x] NEW: Google id_token -> access + refresh JWT for stickies-native (replaces the 503 stub)

## Realtime
- [x] `note-created`, `note-updated`, `note-deleted`, `api-request` events
- [x] `livePayload()` 8KB guard drops `content`/`doc` and flags `content_omitted`
- [x] `api-request` broadcast for external callers only, with method/path/ip/ua/auth/at/summary
- [x] Transport is SSE, replacing Pusher (drops 1 paid dep and the 10KB cap)

## Keys - `/keys`
- [x] GET list, POST create (plaintext returned once), DELETE soft-revoke
- [x] Owner-only via `local`/`jwt`; machine keys get 403 `Key management is owner-only`

## Public sharing
- [x] `/public?noteId=` -> `{title, content, type, folder_color}`; 404 when not `is_public`
- [x] Locked note returns `{locked:true, title, folder_color}` without content
- [x] `/public/raw` + `/share` + `/raw` aliases, CORS `*`, GET/POST/OPTIONS
- [x] `?as=text`, `?theme=dark|light`, `?unlocked=1` reveal animation
- [x] HTML notes get `Content-Security-Policy: sandbox allow-scripts allow-popups`
- [x] `X-Note-Title` header, `Cache-Control: private, no-store`
- [x] OG/Twitter meta injection, `<title>` only when absent
- [x] Passcode gate: scrypt verify, HMAC unlock cookie bound to noteId + hash, 30d, httpOnly
- [x] Rate limit 10 attempts / 5 min / IP, 429 + `Retry-After: 300`
- [x] `/share?clip=|data=` -> 308 to `/clip`
- [x] OG image 1200x630, locked notes render the SAFE card with no body
- [x] FIXED: POST success + gate responses currently omit CORS headers though OPTIONS advertises POST

## Integrations + automations
- [x] `/automations` GET (with `last_fired` from ok logs), POST; `/[id]` PATCH, DELETE
- [x] `/automation-logs` GET, `?automation_id`, `?limit` clamped 100
- [x] `/integrations` GET active only, POST; `/[id]` PATCH, DELETE
- [x] FIXED: `/integrations/[id]` PATCH has no try/catch on `req.json()`

## Google Drive
- [x] `/gdrive` POST multipart -> `Stickies/<folder>/<file>`, public-read permission
- [x] Images served back through `/gdrive?img=<id>`, immutable 1y cache, unauthenticated by design
- [x] PDF text extraction via pdf-parse on upload
- [x] OAuth: `/gdrive/auth` (state cookie, 600s), `/gdrive/callback` (timing-safe state verify)
- [x] Token refresh writes back to `integrations`
- [x] `/gdrive/status` -> `{connected, via: local|proxy|none}`
- [x] `/upload` forwards multipart to `/gdrive`
- [x] Replace `googleapis` (~100MB) with direct REST + fetch

## Hue
- [x] `/hue/trigger` POST: colour validate, group validate, remote API then local bridge fallback
- [x] Remote requires BOTH `Authorization: Bearer` and `hue-application-key`
- [x] 60s debounced auto-restore of original xy + brightness, skipped in ambient mode
- [x] `/hue/trigger` DELETE restores immediately
- [x] `/hue/groups` GET merges `grouped_light` + `room` + `zone`
- [x] `mode:off` -> `{ok:false, reason:"light mode is off"}`; lights off -> `{ok:false, reason:"lights off"}`

## Misc
- [x] `/backup` GET `.sql` dump (TRUNCATE + INSERTs, `'` doubled) and `?format=json`
- [x] `/backup` POST dispatches the GitHub Actions workflow
- [x] `/ai` POST streams `text/plain` from Anthropic, model `claude-sonnet-5`, 4096 max tokens
- [x] `/folder-icon` GET map, PATCH set (folder icon lives in the folder row's `content`)
- [x] `/local` POST, Hue flash then 300ms then broadcast, serialized on a queue
- [x] `/csp-report` POST, 204 always, logs in dev only
- [x] `/build-id` GET, `{id}`, no-store
- [x] `/logout` POST -> session revoke
- `drop` `/api/auth/[...nextauth]` - replaced by the JWT endpoints
- `drop` `/auth/native-callback` - it is a 503 stub today, superseded by real native auth

## Schema, unchanged
`stickies` (30 cols), `api_keys`, `integrations`, `automations`, `automation_logs`,
`user_preferences`, `users`, `sessions`, `accounts`.
- [ ] Replace the 5 lazy `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` calls with real migrations

## Found while porting, fixed here

1. `lock_password_hash`, the scrypt hash of a note's share passcode, was returned
   by `SELECT *` on `?id=`, `?export=1` and `?route=` to every authenticated
   caller including keyed agents. 11 notes carry one. Excluded from all reads.
2. `/integrations/[id]` PATCH parsed its body with no try/catch, so a malformed
   JSON body threw a raw 500 instead of a 400.
3. PDF text extraction never worked: the call shape did not match pdf-parse v2,
   so every PDF upload silently stored an empty string.
4. The share passcode POST responses carried no CORS headers even though OPTIONS
   advertised POST, so a cross-origin submit failed.

## Dropped on purpose

- `googleapis`, about 100MB, replaced with direct Drive v3 REST calls.
- The Anthropic SDK, replaced with a fetch against the same endpoint.
- `next/og`, replaced with hand-built SVG plus a rasterizer.
- Pusher, replaced with SSE this process serves itself.
- The gdrive proxy-to-prod fallback: this service is the single origin now.
