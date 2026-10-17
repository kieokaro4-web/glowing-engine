# Local Directus Todo Demo: Setup, Diagnostics, And Test Record

This document records how this demo is wired, how to start and verify it, what was learned from the Directus docs, and which commands were actually tested.

- **Validation date:** 2026-10-17
- **Environment:** Ubuntu 24.04 Codespace, Docker, Bun 1.4.3, Directus image `directus/directus:11` (digest `eb326f679ae8`, = 11.17.4), SQLite (embedded in the Directus container)

## Directus supports local — confirmed

Unlike hosted-only backends, Directus is designed to be self-hosted: the official Docker image runs the full server (API, Data Studio, realtime) locally with no account, and SQLite means not even a separate database container is required. There was no reason to push back on this request. The [self-hosting docs](https://directus.com/docs/self-hosting/overview) and [database configuration](https://directus.com/docs/configuration/database) (`DB_CLIENT` accepts `sqlite3`) confirm it.

## Scope

The app is React + Vite, identical in UI and behavior to the other `todo-demo-*` apps. Directus runs in one Docker container on port 8055 with a SQLite file under `directus/database/`. Browser requests go to Vite on port 5176; Vite proxies `/items` (REST) and `/websocket` (realtime) to Directus, so the browser stays same-origin. The `todos` collection and its public access are created programmatically by a bootstrap script talking to the Directus schema/permissions API.

```text
Browser
  | HTTP / WebSocket, localhost:5176
  v
Vite same-origin proxy
  | http/ws 127.0.0.1:8055
  v
Directus container (REST /items, WebSocket /websocket, Studio /admin)
  |
  v
SQLite file: ./directus/database/data.db
```

This is a local development stack, not a production deployment. The demo deliberately grants the built-in Public policy create/read/update/delete on `todos`, which makes the app anonymous-accessible. Do not reuse that policy setup in a hosted project.

## Prerequisites And Versions

- Bun on `PATH` (1.4.3 used here). No npm/npx commands anywhere: `bun install`, `bun run dev`, `bun scripts/directus-bootstrap.ts`.
- Docker daemon available. The image `directus/directus:11` is pulled on first run (~1.2 GB).
- Run `bun install` once from this directory.

## Start The Stack

Start Directus in one terminal:

```sh
cd /workspaces/glowing-engine/todo-demo-dt
bun run directus:debug
```

This helper:

1. Creates `directus/{database,uploads,extensions}` and a stable `directus/.secret` (Directus's default random `SECRET` would invalidate tokens on every restart).
2. Removes any previous `todo-demo-dt-directus` container and starts a fresh one bound to `127.0.0.1:8055` with the env vars below. Data persists in `./directus/`.
3. Polls `GET /server/ping` (unauthenticated healthcheck) until ready.
4. Runs `bun scripts/directus-bootstrap.ts`, which idempotently creates the `todos` collection and grants the four public actions.
5. Appends container status and the last 60 log lines to `directus-start.log` (mode 600 — it contains the demo admin token).

Start Vite in a second terminal:

```sh
cd /workspaces/glowing-engine/todo-demo-dt
bun run dev
```

Open <http://localhost:5176/>.

### Key Environment Variables

| Variable | Value here | Why |
| --- | --- | --- |
| `DB_CLIENT` / `DB_FILENAME` | `sqlite3` / `/directus/database/data.db` | Embedded database, no DB container. |
| `SECRET` | stable value from `directus/.secret` | Signs tokens; random default breaks sessions on restart. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / `admin-demo-password` | Data Studio login at <http://127.0.0.1:8055/>. |
| `ADMIN_TOKEN` | `local-demo-admin-token` | Static admin token; used **only** by the bootstrap script, never shipped to the browser. |
| `WEBSOCKETS_ENABLED` | `true` | **Realtime is disabled by default on self-hosted.** |
| `WEBSOCKETS_REST_AUTH` | `public` | Default `handshake` requires an auth message first; `public` allows anonymous subscriptions limited to the Public policy. |
| `CORS_ENABLED` / `CORS_ORIGIN` | `true` / vite origins | Only needed if you bypass the proxy; off by default in Directus. |

`.env.local` contains `VITE_DIRECTUS_URL=http://127.0.0.1:5176` — the app's own origin, so all Directus traffic is same-origin and flows through the Vite proxy. There is no anon-key concept: unauthenticated requests resolve to the Public policy.

## URLs

| Service | URL |
| --- | --- |
| Todo app | <http://localhost:5176/> |
| Directus REST items | <http://127.0.0.1:8055/items/todos> (also via proxy: <http://127.0.0.1:5176/items/todos>) |
| Directus WebSocket | `ws://127.0.0.1:8055/websocket` — **not** `/ws`; that is the SDK-fixed path (`WEBSOCKETS_REST_PATH=/websocket`) |
| Data Studio | <http://127.0.0.1:8055/> |
| Healthcheck | <http://127.0.0.1:8055/server/ping> |

## Project Files

- `src/App.tsx`: todo UI; Directus CRUD and realtime subscription via the SDK.
- `src/directus.ts`: SDK client (`rest()` + `realtime({ authMode: 'public' })`) and row normalization.
- `vite.config.ts`: same-origin proxy for `/items` and `/websocket`.
- `scripts/directus-start.sh`: container lifecycle, readiness poll, bootstrap invocation, log capture. Optional env overrides: `DIRECTUS_WS_AUTH` (websocket mode, default `public` — used to verify `handshake` mode), `DIRECTUS_HOST_PORT`, `DIRECTUS_ADMIN_*`.
- `scripts/directus-bootstrap.ts`: idempotent `POST /collections` + `POST /permissions` for the Public policy.
- `scripts/docs-crawl.ts`: downloads official docs pages as markdown by parsing each page's Nuxt `_payload.json` and following the `*-surround` next-page anchor. Example: `bun run docs:download /docs/guides/realtime/authentication --max 4`.
- `directus/`: gitignored runtime state (SQLite file, uploads, extensions, `.secret`).
- `.env.local`: gitignored Vite URL.

## What Was Tested

Verification ran in two layers: the demo app itself, and the broader Directus feature surface (including features this app does not use). Scratch harnesses were run with bun, curl, and headless Chromium, then deleted; results below are what those runs observed.

### App Layer

- `bun run build`: passed (`tsc -b` and Vite production build).
- Anonymous REST CRUD through the app's exact endpoints (`/items/todos` GET/POST/PATCH/DELETE): all succeeded; SQLite returns booleans as `0`/`1`, normalized in `src/directus.ts`.
- Raw WebSocket realtime through the Vite proxy: subscribe → `init` → `create` event delivered for a REST insert; server `ping` answered with `pong`.
- SDK realtime (`@directus/sdk` 27.0.0) through the proxy: `createItem`, `subscribe`, and a dedicated test asserting a real `update` event (an earlier draft wrongly passed on the `init` snapshot message; the assertion was corrected).
- Browser UI (headless Chromium, 14/14): add/toggle/delete rows, counters, filters, empty state, and **live cross-tab realtime for insert, update, and delete**; zero console or page errors.
- Data Studio in the browser (5/5): login screen renders, admin email/password login enters the workspace, content module shell renders, `todos` collection visible under Settings → Data Model, and the item table renders existing rows.
- Persistence: `bun run directus:debug` recreates the container; a row inserted before the restart survived, and bootstrap reported `collection todos: already present / public policy: already present` (idempotent).

### Directus Feature Coverage (features beyond this demo)

**Auth — 8/8 passed.** Wrong password rejected (401); admin email/password login returns access+refresh tokens; token works on `/users/me`; `/auth/refresh` returns a new access token; `/auth/logout` accepts the refresh token (204) and the old refresh token is then rejected (401); static `ADMIN_TOKEN` authenticates; anonymous requests to system collections are rejected (403).

**RBAC / policies / users — passed end-to-end.** Created role + policy, granted policy read-only `todos` permission, created user with role, logged in as that user: read → 200, write → 403. Requires the correct M2M payload: `PATCH /roles/:id` with `{"policies": [{"policy": "<policy-id>"}]}` — plain ID arrays and `{"policy": id}` are rejected with `FORBIDDEN` even for admin. (Roles list shows `policies` as junction rows; the returned IDs are junction keys, so verify attachment by effect, not by ID match.)

**Permission enforcement — passed.** A second collection created without policy grants returned 403 for anonymous read **and** write while admin reads worked — public access really is opt-in via policy permissions.

**GraphQL — passed.** Anonymous `{ todos { id title completed } }` returned rows (same policy engine); admin `{ todos_aggregated { count { id } } }` returned counts. Note: the field is `todos_aggregated`, not `todos_aggregates`; count values arrive as strings — coerce.

**REST query features — passed.** `filter[...][_starts_with]`/`[_eq]`, `search`, `sort`, `limit`/`offset`, `fields`, `meta=total_count`, and `aggregate[count]=id` all behaved as documented. `DELETE /items/todos?filter[title][_eq]=...` (delete-by-query) returned 204.

**Schema management — passed.** `GET /schema/snapshot` returned the live snapshot including `todos`; `POST /schema/diff` with the unchanged snapshot returned 204 (no changes); a modified snapshot adding a `verify_apply` collection produced a diff containing it, and `POST /schema/apply {hash, diff}` returned 204 and **actually created the collection** (verified, then removed). Snapshot entries need `schema: {name: ...}` shapes matching `GET /schema/snapshot` — made-up keys (e.g. `schema.comment`) are rejected with 400.

**Files / folders / assets — passed.** `POST /folders` created a folder; multipart `POST /files` uploaded a PNG (200, metadata row); `GET /assets/:id` returned the image bytes for admin and 403 for anonymous; deletes returned 204.

**Flows — passed (4/4) after fixing my own test payloads.** Flow and operation CRUD work, and the engine genuinely executes: a webhook flow with a chained `log` → `exec` operation (`operation` entry field on the flow, `resolve` links between operations) returned `{"echoed":"chain","fromFlow":true}` from `return:"$last"`, with `CHAIN-STEP-1` visible in server logs; a `sleep` operation (`milliseconds`) delayed the sync trigger by its configured time; an event-hook flow (`options {type:'action', scope:['items.create'], collections:['todos']}`) ran an `item-create` operation that wrote a real row as a side effect; runs are recorded in `GET /activity` with action `run`. Earlier "not observable" results were **harness bugs, not Directus bugs**: this build's `exec` scripts receive `module.exports(keyedData)` inside an isolated-vm sandbox (the old `(data, {services})` signature silently throws — use `item-create`/`request` operations for side effects), `sleep` takes `milliseconds` not `ms`, the response option key is `return` not `response`, a fabricated operation type `json` doesn't exist (built-ins: condition, exec, item-create/delete/read/update, json-web-token, log, mail, notification, request, sleep, throw-error, transform, trigger), and flows are only picked up once `flow.operation` points at the entry operation. `POST /flows/:id/trigger` (old manual path) does not exist; manual triggers are Data-Studio-only.

**Realtime authentication modes — passed both ways.** The start script accepts `DIRECTUS_WS_AUTH` (default `public`). In `handshake` mode: anonymous `subscribe` without auth was rejected (`auth:error` then close) and an `{"type":"auth","access_token":...}` handshake was accepted, with subsequent subscriptions receiving live events. Restored to `public` and re-smoked through the proxy — PASS. Effective config is visible without guessing: `GET /server/info` reports `websocket.rest.authentication/path/heartbeat`.

**System surface — passed.** `/server/ping` healthcheck, `/server/info` (project, limits, websocket settings), `GET /collections` anonymous → 403, `GET /permissions`/`/roles`/`/policies`/`/flows`/`/operations` clean after scratch-resource removal.

### Not tested / caveats

- The PNG screenshot step timed out in headless Chromium (font/animation compositor hang in this harness); UI verification is DOM-assertion based. Browser tests blocked Google Fonts requests (`@import` in styles needs internet); offline the UI still renders with fallback fonts, unverified visually.
- Email-dependent flows (password request/reset, verification), OAuth/SSO (needs external providers), TFA ceremonies, GraphQL subscriptions over `/graphql` websocket, collaborative editing, and webhooks-out were not exercised.
- `GET /logs`, `/flows/:id/logs`, `/server/licenses`, and `/buckets` + multipart `POST /assets` do not exist in this build (404 `ROUTE_NOT_FOUND`) — attempts are recorded here so future readers do not chase them.
- No auth UI in the todo app by design: anonymous access is granted through the Public policy, not through login.

## Directus Facts Learned From The Docs (and confirmed live)

1. **`WEBSOCKETS_ENABLED` defaults to `false`** on self-hosted; realtime is silently dead until you set `true`.
2. The WebSocket endpoint is **`/websocket`** (`WEBSOCKETS_REST_PATH`), not `/ws` as older blog posts say.
3. Websocket auth modes: `public` / `handshake` (default) / `strict`. Anonymous subscriptions only work with `WEBSOCKETS_REST_AUTH=public`, and then run under the Public policy only.
4. In Directus 11 **permissions attach to policies, not roles** (breaking change, [v11 release notes](https://directus.com/docs/releases/breaking-changes/version-11)). The built-in Public policy has a stable UUID (`abf8a154-…`, looked up via `GET /policies` first). `POST /permissions` rows need a `policy` field — one row per action, `fields:["*"]`, `permissions:null` = unrestricted.
5. `POST /collections` **requires `schema` to be present** (even `{}`); omitting it silently creates a "folder" with no table.
6. Heartbeat: server sends `{"type":"ping"}` every 30 s; the client must answer `pong` or get disconnected. `subscription` events: `init` (with current snapshot data), `create`, `update`, `delete` (ids only).
7. SQLite booleans come back as `0`/`1` over both REST and WS.
8. `SECRET` defaults to a random value per boot; persist it or restarts invalidate tokens. There is no `KEY` env in v11.
9. Public data access is off by default: without policy grants, anonymous `GET /items/...` returns `FORBIDDEN`. Good default — the demo opts in explicitly.
10. The docs site is a Nuxt app; page markdown and the prev/next ("surround") anchors live in `<path>/_payload.json`, which `scripts/docs-crawl.ts` follows to download whole doc sections.
11. File uploads in this build go to multipart `POST /files` (there is no `POST /buckets` / `POST /assets` and no bucket API); asset **reads** still serve `GET /assets/:id`, gated by `directus_files` policy permissions.
12. Attaching a policy to a role uses M2M row objects: `PATCH /roles/:id {"policies": [{"policy": "<id>"}]}`. Bare ID arrays, `{"policy": id}`, and junction writes via `/policies` `roles` all fail with generic `FORBIDDEN`.
13. GraphQL aggregation root fields are `<collection>_aggregated`; SQLite count values arrive as strings.
14. Webhook flow triggers (`POST /flows/trigger/:id`) are public capability URLs — current docs list no authentication toggle for them, and the option is ignored if sent.

## Logs And Troubleshooting

- `directus-start.log` (mode 600, contains the demo admin token): start output, bootstrap result, container status, last 60 container log lines.
- `vite-verify.log`: Vite dev-server output when started with the redirect used during verification.
- `docker logs todo-demo-dt-directus` for the live server.

If the app shows a red error banner: confirm `curl http://127.0.0.1:8055/server/ping` returns `pong` (container up), then `curl http://127.0.0.1:5176/items/todos` (proxy + bootstrap applied). Realtime-only failure usually means `WEBSOCKETS_ENABLED` or `WEBSOCKETS_REST_AUTH` is missing after recreating the container manually.

## Reproducing The Checks

The scratch harnesses were removed after validation; these commands reproduce the main results. `ADMIN_TOKEN = local-demo-admin-token`, and all Directus endpoints below assume the container is up on `127.0.0.1:8055`.

```sh
# REST CRUD (anonymous, public policy)
curl -s http://127.0.0.1:8055/items/todos
curl -s -X POST -H 'Content-Type: application/json' -d '{"title":"probe"}' http://127.0.0.1:8055/items/todos
curl -s -X PATCH -H 'Content-Type: application/json' -d '{"completed":true}' http://127.0.0.1:8055/items/todos/<id>
curl -s -X DELETE http://127.0.0.1:8055/items/todos/<id>

# GraphQL + aggregates
curl -s -X POST -H 'Content-Type: application/json' -d '{"query":"{ todos { id title } todos_aggregated { count { id } } }"}' http://127.0.0.1:8055/graphql

# Auth lifecycle
curl -s -X POST -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin-demo-password"}' http://127.0.0.1:8055/auth/login
# then /auth/refresh, /auth/logout with the refresh_token; wrong password => 401

# Schema round-trip
curl -s -H "$ADMIN" http://127.0.0.1:8055/schema/snapshot | bun -e 'console.log(JSON.stringify((JSON.parse(await Bun.stdin.text())).data))' > snap.json
curl -s -X POST -H "$ADMIN" -H 'Content-Type: application/json' --data-binary @snap.json http://127.0.0.1:8055/schema/diff   # 204 when unchanged

# Files: upload + anonymous asset block
curl -s -H "$ADMIN" -F title=probe.png -F file=@tiny.png http://127.0.0.1:8055/files
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8055/assets/<id>    # 403 anonymous

# Realtime smoke (bun script): connect ws://127.0.0.1:5176/websocket,
# answer {"type":"ping"} with {"type":"pong"}, send
# {"type":"subscribe","collection":"todos","event":"create","uid":"x"}
# then POST an item via REST and expect a subscription/create message.

# Flows (the version-correct payload shapes matter most here):
# 1. POST /flows {trigger:'webhook', status:'active', accountability:'all',
#    options:{method:'POST', return:'$last'}}
# 2. POST /operations {type:'exec'|'sleep'|'item-create', flow:<id>, key:<str>,
#    position_x, position_y, options:{...}}   # exec code: module.exports = async (data) => ({...})
#    sleep options: {milliseconds:N}; item-create options: {collection,payload,permissions:'$full'}
# 3. Chain steps: PATCH operation {resolve:<next-id>}; PATCH flow {operation:<entry-id>}
# 4. curl -X POST http://127.0.0.1:8055/flows/trigger/<flow-id> -d '{"marker":"chain"}'
#    # => 200 with the exec result; log-operation messages appear in `docker logs`
# 5. Event-hook proof: flow {trigger:'event', collection:'todos',
#    options:{type:'action', scope:['items.create'], collections:['todos']}} + item-create op,
#    then POST /items/todos and watch the marker row appear.
#    Runs are visible in GET /activity?filter[action][_eq]=run.

# RBAC attach (the only accepted shape)
curl -s -X PATCH -H "$ADMIN" -H 'Content-Type: application/json' \
  -d '{"policies":[{"policy":"<policy-id>"}]}' http://127.0.0.1:8055/roles/<role-id>

# Websocket handshake mode (anon subscribe must fail, token auth must pass)
DIRECTUS_WS_AUTH=handshake bun run directus:debug
```

Browser-level UI and Studio verification used headless Chromium (`chrome-linux/chrome` from the Playwright cache) driven by Playwright scripts; the font `@import` must be blocked/routed in the harness or `page.screenshot()` hangs in this environment.

## Stop And Preserve Data

```sh
docker stop todo-demo-dt-directus   # keeps ./directus/database/data.db
```

`bun run directus:debug` recreates the container but preserves the same SQLite file. Delete the `directus/` directory for a factory reset. Stop Vite with `Ctrl+C` in its terminal.
