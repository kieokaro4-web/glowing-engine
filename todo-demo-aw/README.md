# Local Appwrite Todo Demo: Setup, Diagnostics, And Test Record

This document records how this demo is wired, how to start and verify it, what
failed in this Codespace, what evidence identified the cause, what changed, and
which commands were actually tested. It mirrors `../todo-demo-sb/README.md` for
the Supabase demo and `../todo-demo-nh` for the Nhost demo, with the same
"Little Things" React UI and a per-backend data layer.

- **Validation date:** 2026-10-17
- **Environment:** Ubuntu 24.04.5 Codespace, Docker 29.8.0, Docker Compose v5.5.1, Bun 1.4.3, Node 24
- **Backend:** Appwrite **2.5.0** (self-hosted)
- **Client SDK:** `appwrite@29.0.0` (message-based Realtime)

## Scope

The app is React + Vite. Appwrite runs as a local Docker Compose stack. Browser
requests go to Vite on port **5175**; Vite proxies the Appwrite API
and Realtime WebSocket path (`/v1`) to Appwrite's Traefik gateway on port 80.
The `todos` table is created through Appwrite's **TablesDB** REST API and
accessed the same way by the client. Realtime broadcasts row changes to
subscribed clients over a single WebSocket.

```text
Browser
  | HTTP / WebSocket, localhost:5175  (or the Codespace :5175 preview URL)
  v
Vite same-origin proxy  (adds Host: localhost)
  | http://127.0.0.1:80
  v
Appwrite Traefik -> appwrite (REST /v1)  +  appwrite-realtime (/v1/realtime ws)
  | Docker bridge network "appwrite"
  v
PostgreSQL (TablesDB)   Redis (pub/sub + cache)
```

The Vite proxy keeps the browser same-origin (no CORS preflight, cookies scoped
to one host). Appwrite's Traefik routes by hostname, so the proxied request must
present `Host: localhost` to match `_APP_DOMAIN`; `vite.config.ts` sets that.

This is a local development stack, not a production deployment. The demo's table
permissions deliberately grant anonymous users read, create, update, and delete.
Do not reuse those policies or the local signing key in a hosted project.

## Prerequisites And Versions

- Bun is installed and on `PATH`.
- Docker and its daemon are available.
- `jq` is available (used by `scripts/provision.sh`).
- Run `bun install` once from this directory.
- Create the compose env before first start (it is git-ignored):
  ```sh
  cp appwrite/.env.example appwrite/.env
  # then edit appwrite/.env: set _APP_OPENSSL_KEY_V1 to any random secret string
  ```
- The Appwrite image is pinned to `2.5.0` via `_APP_VERSION` because the client
  SDK `appwrite@29` targets self-hosted **2.5.x**.

## Start The Stack

Start Appwrite in one terminal:

```sh
cd /workspaces/glowing-engine/todo-demo-aw
bun run appwrite:debug
```

This helper:

1. Pre-creates the four Appwrite Docker networks (`appwrite`, `gateway`,
   `browser`, `runtimes`) with stable names and derives each bridge interface.
2. Inserts an idempotent legacy-iptables `FORWARD` ACCEPT rule for same-bridge
   traffic on each (see *Firewall* below — the same class of fix the Supabase
   demo needed).
3. Runs `docker compose -p appwrite --env-file .env up -d`.
4. Waits for `GET http://localhost/v1/health/version` and appends container
   status to `appwrite-start.log`.

The first run pulls several GB of images. The stack is intentionally **trimmed**
(see *Why The Stack Is Trimmed*) so its pull peak fits the Codespace disk.

## Provisioning — One Console Step, Then Script

Appwrite 2.5 self-hosted grants the first user **owner/admin** rights only
through the **Console web UI** first-run. There is no supported headless path to
create that first admin (this was tested and explained in *Provisioning Wall*).

1. With the stack up, open the Console. In this Codespace the forwarded URL is:
   `https://<codespace-name>-80.app.github.dev`
   (Traefik must match that host, so `_APP_DOMAIN` is set to it during onboarding
   and reset to `localhost` afterwards — see `appwrite/.env`.)
2. Create the first account (email/password/name). On success you land at
   `.../organizations/<ORGANIZATION_ID>` — note that id from the URL.
3. Provision the database, table, and API key headlessly:

```sh
ADMIN_EMAIL='you@example.com' \
ADMIN_PASSWORD='your-password' \
ORGANIZATION_ID='6ad39c3b0003c393942d' \
bun run appwrite:provision
```

`scripts/provision.sh` logs in, creates the `todo-demo-aw` project and a
`provisioner` API key (org-scoped endpoints), then creates the `todos` database
(type `tablesdb`), the `todos` table with public `Role.any()` permissions and
`rowSecurity:false`, and the `title` (string, required, max 180) and `completed`
(boolean, default false) columns. Anonymous auth is enabled on the project by
default. The worker finalizes the schema; the script waits for
`status: "available"`.

## Run The App

```sh
cd /workspaces/glowing-engine/todo-demo-aw
bun run dev        # http://localhost:5175
```

`.env.local` (git-ignored) holds the non-secret resource ids:

```
VITE_APPWRITE_ENDPOINT=http://localhost:5175/v1
VITE_APPWRITE_PROJECT_ID=todo-demo-aw
VITE_APPWRITE_DATABASE_ID=todos
VITE_APPWRITE_TABLE_ID=todos
```

## URLs And Local Endpoints

| Service | URL |
| --- | --- |
| Todo app | http://localhost:5175/ |
| Appwrite API (via Vite proxy) | http://localhost:5175/v1/ |
| Appwrite Traefik gateway | http://127.0.0.1:80/ (Host: localhost) |
| Console | http://localhost/ (port 80) |

Traefik maps host ports `80` (http), `4443` (https), `48883` (mqtt), `4084`
(mqtt-ws). `443` was avoided because Nhost's Traefik owned it during earlier
work. The app only uses `80` (plain HTTP) through the proxy. `_APP_OPENSSL_KEY_V1`
is a dev-only signing value in the ignored `appwrite/.env`.

## Project Files

- `src/App.tsx` — todo UI; TablesDB CRUD + Realtime subscription + anonymous session.
- `src/appwrite.ts` — Appwrite `Client`, `TablesDB`, `Account`, `Realtime`, and `Todo` type.
- `src/styles.css`, `src/main.tsx`, `index.html`, `tsconfig.json` — identical to the Supabase demo.
- `vite.config.ts` — same-origin `/v1` HTTP + WebSocket proxy to Traefik, forcing `Host: localhost`.
- `appwrite/docker-compose.yml` — the official Appwrite 2.5.0 compose stack.
- `appwrite/docker-compose.override.yml` — trims the stack (see below) and rewrites `appwrite`/`realtime` `depends_on`.
- `appwrite/.env.example` — the full Appwrite env template with secrets replaced by `CHANGE-ME` placeholders. Copy it to `appwrite/.env` and set `_APP_OPENSSL_KEY_V1` before first start.
- `appwrite/.env` — the real (git-ignored) config used by this Codespace: `docker-compose.yml` needs a `.env` in the same directory; Docker Compose auto-loads it.
- `scripts/appwrite-debug.sh` — network/firewall setup, `up -d`, health wait, log capture.
- `scripts/provision.sh` — headless project/key/database/table/columns provisioning after Console onboarding.
- `.gitignore` — ignores `node_modules/`, `dist/`, `.env`, `.env.local`, `appwrite-start.log`, `*.log`.

## What Was Tested

Results below distinguish successful commands from things that were not tested.
Appwrite is reached through Traefik with `Host: localhost`.

### App And HTTP Services

- `bun install`: succeeded (`appwrite@29.0.0` and tooling installed).
- `bun run build`: passed (`tsc -b` and Vite production build).
- `docker compose ... up -d`: appwrite, appwrite-realtime, appwrite-worker,
  appwrite-console, appwrite-postgresql, appwrite-redis, appwrite-traefik all
  `Up`; appwrite/console/postgresql/redis report **healthy**.
- `GET /v1/health/version`: `{"version":"2.5.0"}` (HTTP 200).
- `GET /v1/health` and `GET /v1/health/db` (server key): `status:"pass"` for both
  `Console.DB` and `Projects.DB`.
- `GET /v1/locale` (client): 200. `GET /v1/avatars/initials?name=...`: 200, valid
  PNG.
- `GET /` (Console) with `Host: localhost`: HTTP 200.
- Vite dev server `GET http://localhost:5175/`: HTTP 200, and `/v1/*` requests
  through the proxy returned 200/201 (health, list, create).

### TablesDB CRUD + Queries

Using `POST/GET/PATCH/DELETE /v1/tablesdb/todos/tables/todos/rows`:

| Action | Caller | Result |
| --- | --- | --- |
| Create `{rowId:"unique()",data:{title}}` | anonymous session | `201` |
| List | a **different** anonymous session | `200`, sees the other user's row |
| Update `{data:{completed:true}}` via `PATCH` | different anonymous session | `200` |
| Delete | different anonymous session | `204` |
| Create / List / Update / Delete | guest (no session cookie) | `201 / 200 / 200 / 204` |
| `Query.limit`, `Query.offset`, `Query.orderDesc` (+`limit`) | client | `200` |
| `Query.equal("completed",[false])` | client | `200`, filtered count |
| `Query.search("title", ...)` | client | `400` until a `fulltext` index exists; then `200` |

Cross-user success confirms `rowSecurity:false` makes the table-level
`read/create/update/delete("any")` govern every row — the Appwrite analogue of
the Supabase demo's anonymous RLS policies. Query JSON was generated from the SDK
(`Query.*`), i.e. the exact shapes the app sends. Note: `PUT /rows/{id}` is the
**upsert** route and needs `data`/`permissions`; `updateRow` uses `PATCH` with the
columns nested under `data` — which is what the app sends.

### Indexes + Full-text search

`Query.search` is not used by the demo UI, but was exercised: without a full-text
index it returns `400 "Searching by attribute \"title\" requires a fulltext
index"`. Creating one via `POST /v1/tablesdb/todos/tables/todos/indexes` with
`{"key":"...","type":"fulltext","columns":["title"]}` (note the param is `columns`,
and creation is async — `status` goes `processing` → `available` via the worker)
made `Query.search("title","milk")` return `200` with the matching row. The index
and test rows were deleted afterward.

### Auth (email/password + sessions)

Created a verified user with a scoped API key, then drove the real client flow:
`POST /v1/account/sessions/email` login → `201`; `GET /v1/account` → `200` (correct
email); an authenticated `POST` row write → `201`; `GET /v1/account/sessions` →
`200 total:1`; `DELETE /v1/account/sessions/current` (logout) → `204`; `GET
/v1/account` after logout → `401`. Anonymous session
(`POST /v1/account/sessions/anonymous`) → `201` (this is what the app uses for
Realtime). The test user was deleted afterward.

### Teams

As a logged-in user: `POST /v1/teams` → `201`; `GET /v1/teams` → `200 total:1`;
`GET /v1/teams/{id}/memberships` → `200 total:1` (creator auto-joins);
`DELETE /v1/teams/{id}` → `204`.

### Storage

With a bucket/files-scoped key: `POST /v1/storage/buckets` → `201`; multipart
`POST /v1/storage/buckets/demo/files` upload → `201`; public `GET` file metadata →
`200` (`sizeOriginal` correct); public `GET .../download` → `200` returning the
uploaded bytes. File `DELETE` → `204` and bucket `DELETE` → `204` (synchronous
delete worked even with the deletes-worker trimmed). The demo bucket was removed.

### GraphQL and account read (extras)

`POST /v1/graphql` introspection (`{ __schema { queryType { name } } }`) → `200`
with `{"data":{"__schema":{"queryType":{"name":"Query"}}}}`, confirming the GraphQL
API is live. An anonymous user's `GET /v1/account` → `200` (its own `status:true`
record), i.e. the session-scoped account surface works.

### Realtime

A Bun WebSocket client connected to `ws://localhost/v1/realtime?project=todo-demo-aw`,
sent `{type:"authentication",data:{session}}` (Realtime needs a session —
`account.createAnonymousSession()` provides it in the app), then
`{type:"subscribe",data:[{channels:["tablesdb.todos.tables.todos.rows"]}]}`. A
create → update → delete sequence delivered `{type:"event",data:{...}}` messages
whose `events` arrays contained `tablesdb.todos.tables.todos.rows.<rowId>.create`,
`.update`, and `.delete`. Result: **PASS — realtime delivered all three verbs.**
The app reloads its list on any event, matching the Supabase/Nhost demos.

**Combined automated feature run: 18/18 PASS** (queries, auth lifecycle, teams,
storage), plus the realtime three-verb test and the full-text-search-with-index
test — every feature that runs in this trimmed instance passed.

### Not Tested — and why

*Environment-limited (external dependency, out of scope per instruction):*
- Email delivery flows — password reset, email verification/confirmation codes,
  magic URL / email-OTP — need a reachable SMTP server; none is configured (no
  mail service in the trimmed stack). The password *login* path itself was tested.
- Third-party OAuth providers (Google/GitHub/...) and WebAuthn/passkey ceremonies
  need external identity providers and a browser.
- The full Console browser click-through of the running app in this Codespace
  (port-forward + cross-host cookies) — the request path was validated at the
  proxy and API layers above instead.

*Disabled by the stack trim (see "Why The Stack Is Trimmed") — these services
are not running, so their features cannot be exercised here:*
- Cloud Functions / Site deployments (executor + orchestrator disabled).
- Messaging / MQTT realtime transport (mqtt container disabled).
- Legacy DocumentsDB (MongoDB disabled; this demo uses TablesDB/PostgreSQL).
- Usage analytics / ClickHouse-backed stats (disabled).
- Session geolocation enrichment (geo disabled; `countryCode` resolves to `"--"`).
Enabling and verifying any of these means re-pulling their heavy images.

### Housekeeping

All verification artifacts (test rows, the `tester01` user, the `demo` bucket and
its file) were deleted afterward; the `todos` table is left empty and
`GET /v1/health/version` still returns `2.5.0`. Two project API keys remain:
`provisioner` (schema) created by `provision.sh`, and `adminfull` created ad hoc
for this verification.


## Why The Stack Is Trimmed

The official Appwrite 2.5 compose stack launches ~17–20 containers. Its images
exceeded the free disk in this Codespace during the **pull peak** (Docker keeps
the compressed layer and the extracted layer on disk simultaneously), so the
plain `up` could not complete. Two things were done:

1. Freed disk by deleting the Supabase demo's containers and images, and later
   the Nhost and Directus containers/images once those were declared finished
   (per instruction), leaving only the Appwrite stack running.
2. Trimmed the stack via `docker-compose.override.yml`, gating the
   demo-irrelevant services behind an `optional` profile so they never start or
   pull: `appwrite-browser`, `appwrite-autogravity`, `appwrite-geo`,
   `appwrite-mqtt`, `clickhouse`, `openruntimes-executor`, `orchestrator`,
   `mariadb`, `mongodb`. `_APP_USAGE_STATS=disabled` removes the ClickHouse
   dependency. `appwrite`/`appwrite-realtime` `depends_on` were rewritten
   (Compose concatenates lists, so `!override` is used) to drop `geo`/`autogravity`.

What remains is the smallest set that serves TablesDB REST + Realtime: `appwrite`
(REST + DB migration), `appwrite-realtime` (WebSocket), `appwrite-worker`
(finalizes schema/column jobs — see below), `appwrite-console` (first-run only),
`appwrite-postgresql`, `appwrite-redis`, `appwrite-traefik`. `appwrite-geo` is
disabled; sessions still work (Appwrite logs `countryCode:"--"`). `appwrite-worker`
is required: it is a background job processor for column/table status transitions.

## Firewall

The Codespace Docker host's legacy `iptables` `FORWARD` chain defaults to `DROP`
and only allows the `docker0` bridge. Appwrite's containers talk to each other
across user-defined bridges (`appwrite`, etc.), so the same failure the Supabase
demo hit applies here: containers cannot reach PostgreSQL/Redis by hostname.
`scripts/appwrite-debug.sh` pre-creates the named networks, derives each
`br-<id>` interface, and inserts an idempotent
`-i <bridge> -o <bridge> -j ACCEPT` rule via a short-lived privileged container.
Evidence the fix works: `appwrite` reaches `appwrite-postgresql` and reports
healthy only after the rule is in place.

## Provisioning Wall (Why The Console Is Required)

Creating the first admin headlessly was tested and does not work on 2.5
self-hosted:

- `POST /v1/account` (project `console`) creates a user, but a subsequent
  `POST /v1/organization/projects` returns `401 missing scopes(["projects.write"])`;
  the user has **0 memberships** and role `users`. Verified twice (including a
  non-disposable email).
- `GET`/`POST /v1/organizations` → `404` (no org REST on self-host).
- An `X-Appwrite-JWT` signed with `_APP_OPENSSL_KEY_V1` → treated as role `guests`.
- The old in-container CLI tasks (`admin-create`, `project-create`) are removed
  in 2.x; `php /usr/src/code/app/cli.php <task>` returns "No command found".

Appwrite only elevates the very first account through the Console first-run.
After that single browser step, everything else (project, key, database, table,
columns) is plain REST and is done by `scripts/provision.sh`.

## Failure And Diagnosis Timeline

1. Original task was TrailBase; it was switched to Appwrite before any Appwrite
   work began (only the `trail` binary had been installed — nothing here depends
   on it).
2. `docker compose up -d` of the full official stack exhausted disk mid-pull
   (free space fell toward 1 GB while extracting the shared `appwrite/appwrite`
   image plus `geo` (1.75 GB of models), `clickhouse`, `mongo`, `executor`).
   The pull was stopped before Docker hit "no space left".
3. Deleted Supabase then Nhost images and trimmed the stack with the override;
   relaunch reached **healthy**.
4. Headless first-admin provisioning was proven impossible (see the wall), so a
   one-time Console onboarding was used; `_APP_DOMAIN` was temporarily set to the
   Codespace :80 host so the browser Console routed correctly, then reset to
   `localhost` for the Vite proxy path.
5. `POST /v1/tablesdb` created the database as type `tablesdb` (the `/v1/databases`
   route creates a `legacy` database; the row/TablesDB API needs `tablesdb`).
6. The table stayed `status:"processing"` because schema jobs run in a worker;
   re-enabling `appwrite-worker` transitioned it to `available`.
7. `PUT /rows/{id}` returned `400 row_missing_payload`; correct partial update is
   `PATCH` with the columns under `data` — which `TablesDB.updateRow` already sends.

## Logs And Troubleshooting

```sh
tail -f appwrite-start.log            # written 0600; may contain local credentials
docker ps --filter 'name=appwrite' --format 'table {{.Names}}\t{{.Status}}'
docker logs --tail 100 appwrite
docker logs --tail 100 appwrite-worker      # schema/column jobs
curl -s -H 'Host: localhost' http://127.0.0.1:80/v1/health/version
```

- If `appwrite` never becomes healthy, check the firewall rule and that
  `appwrite-postgresql` / `appwrite-redis` are healthy and reachable by hostname.
- If the Console does not load, confirm `_APP_DOMAIN` matches the host you open
  (Codespace :80 preview host during onboarding; `localhost` for the app path).
- If a table stays `processing`, make sure `appwrite-worker` is running.

## Stop And Preserve Data

```sh
cd appwrite
docker compose -p appwrite --env-file .env stop       # keep volumes (data preserved)
docker compose -p appwrite --env-file .env down -v     # also delete all Appwrite data
```

`bun run appwrite:debug` stops nothing on its own; it starts the stack. Data lives
in named Docker volumes (`appwrite_appwrite-mariadb` etc.). Stop Vite with Ctrl+C.

## Disk Note

This demo leaves a large Docker footprint. If disk is tight, you can safely
remove unused images (they re-pull on next start): `docker image prune`, or remove
`appwrite/new` (Console) once the first admin already exists, since the app path
does not need it. Do not remove `appwrite/appwrite`, `appwrite/postgres`, `redis`,
`traefik`, or the named `appwrite_appwrite-*` volumes you want to keep.
