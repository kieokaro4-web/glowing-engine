# Local TrailBase Todo Demo: Setup, Wiring, Diagnostics, And Test Record

This document records how this demo is wired, how to start and verify it, what
failed in this Codespace, what evidence identified the cause, what changed, and
which commands were actually tested. It is the TrailBase sibling of the
Supabase (`todo-demo-sb`) and Nhost (`todo-demo-nh`) demos: the **UI, copy,
features, and design are identical** across all three. Only the backend and its
data layer differ.

- **Validation date:** 2026-10-17
- **Environment:** Ubuntu 24.04.5 Codespace, x86_64, Bun 1.4.3, TrailBase `trail` v0.34.7 (SQLite 3.53.2), Vite 7.3.7, React 19.3.1, TypeScript 5.8.3

## Scope

The app is React + Vite. TrailBase is a **single self-contained executable**
with an embedded SQLite database — it is not a Docker stack. The browser talks
to Vite on port 5175; Vite proxies `/api/*` to the TrailBase HTTP server on
`127.0.0.1:4000`. The `todos` table is created by a SQL migration and exposed
through TrailBase's REST **records API**. Realtime is delivered over **Server-
Sent Events (SSE)** because the `todos` record API sets `enable_subscriptions`.

```text
Browser
  | HTTP / SSE, http://localhost:5175
  v
Vite same-origin proxy  (/api -> 127.0.0.1:4000)
  |
  v
TrailBase (single binary)
  |- REST records API   /api/records/v1/todos
  |- Realtime SSE       /api/records/v1/todos/subscribe/*
  |- Auth               /api/auth/v1/*
  |- Admin UI           /_/admin/
  `- embedded SQLite    traildepot/data/main.db (+ session.db, logs.db)
```

The Vite proxy keeps every browser request same-origin. Because TrailBase binds
to a loopback TCP port directly (no container networking), this demo does **not**
need the iptables/bridge forwarding workaround used by the Supabase and Nhost
start scripts.

Like the other two demos, this is a local development stack. The `todos` record
API grants anonymous **world** create/read/update/delete access so the demo runs
without sign-in. Do not reuse those ACLs in a hosted project.

## Prerequisites And Versions

- **Bun** on `PATH` (`bun --version` reported `1.4.3`). All commands use `bun` /
  `bunx`; no `npm` or `npx` is required or used.
- **TrailBase** `trail` binary on `PATH`. Install the official binary:

  ```sh
  curl -sSL https://trailbase.io/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"   # installs to ~/.local/bin/trail
  trail --version                          # v0.34.7-... (sqlite: 3.53.2)
  ```

- Run `bun install` once from this directory.
- No Docker is required for this demo.

## Start The Stack

Start TrailBase in one terminal:

```sh
cd /workspaces/glowing-engine/todo-demo-tb
bun run trailbase:debug
```

This helper (`scripts/trailbase-start.sh`):

1. Verifies `trail` is on `PATH`; if not, it prints the install command and exits.
2. Ensures the committed depot layout exists (`traildepot/migrations/main`).
3. Creates `trailbase-start.log` and sets its mode to `600` before writing,
   because the first boot logs the generated admin password.
4. Runs `trail --depot ./traildepot run --address 127.0.0.1:4000 --stderr-logging`,
   streaming to the terminal and the log via `tee`.

`trail run` is a long-lived **foreground** server (like `bun run dev`). On the
first run it creates the depot runtime directories (`data/`, `secrets/`,
`backups/`, `uploads/`, `wasm/`, `metadata.textproto`), applies the committed
migration, and **prints a freshly generated admin password**. It is a restart on
each invocation and preserves the SQLite data volume.

Start Vite in a second terminal:

```sh
cd /workspaces/glowing-engine/todo-demo-tb
bun run dev
```

Open <http://localhost:5175/>.

## Endpoints And Local URLs

| Thing | URL or connection |
| --- | --- |
| Todo app | <http://localhost:5175/> |
| TrailBase API (direct) | `http://127.0.0.1:4000/api/...` |
| Healthcheck | `http://127.0.0.1:4000/api/healthcheck` → `Ok` |
| Admin UI | <http://127.0.0.1:4000/_/admin/> |
| Records: list | `GET /api/records/v1/todos?order=-created_at` |
| Records: read one | `GET /api/records/v1/todos/{id}` |
| Records: create | `POST /api/records/v1/todos` (JSON body) |
| Records: update | `PATCH /api/records/v1/todos/{id}` (JSON body) |
| Records: delete | `DELETE /api/records/v1/todos/{id}` |
| Records: JSON schema | `GET /api/records/v1/todos/schema` |
| Realtime | `GET /api/records/v1/todos/subscribe/*` (SSE) |

The client uses **relative** `/api/...` paths (`.env.local` leaves
`VITE_TRAILBASE_URL` empty), so requests stay same-origin on Vite and no API key
or token is needed for the demo's world-ACL'd `todos` table. Setting
`VITE_TRAILBASE_URL=http://127.0.0.1:4000` would bypass the proxy and require
`trail run --dev` for CORS; the same-origin default avoids that.

### Admin credentials

On first boot TrailBase creates `admin@localhost` with a random password in the
server log. Retrieve it from `trailbase-start.log` (mode `600`), or manage it
explicitly:

```sh
trail --depot ./traildepot admin list
trail --depot ./traildepot user --help
```

The todo app itself implements **no auth UI** — matching both existing demos.

## Schema And Record Collection

The table lives in a committed migration:
`traildepot/migrations/main/U1785000000__todos.sql`.

```sql
CREATE TABLE todos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
) STRICT;
```

The API name and access control live in `traildepot/config.textproto` (protobuf
text format; schema at
<https://github.com/trailbaseio/trailbase/blob/main/crates/core/proto/config.proto>):

```textproto
record_apis: [
  {
    name: "todos"
    table_name: "todos"
    enable_subscriptions: true
    acl_world: [ READ, CREATE, UPDATE, DELETE, SCHEMA ]
  }
]
```

Key TrailBase specifics learned while building this (and reflected in the code):

- A records table **must have a suitable primary key**: an `INTEGER` (rowid
  alias) or a UUID `BLOB`. A plain `BLOB PRIMARY KEY` was rejected with
  *"Does not have a suitable PRIMARY KEY column."* This demo uses
  `id INTEGER PRIMARY KEY`.
- `PermissionFlag` values are `CREATE=1, READ=2, UPDATE=4, DELETE=8, SCHEMA=16`.
  `acl_world` applies to anonymous/unauthenticated callers.
- SQLite has no boolean/column default for the UI, so `completed` is stored as
  `0/1` and `created_at` as unix **seconds**. `src/trailbase.ts` maps them to a
  JS `boolean` and an ISO string so `App.tsx` is unchanged from the Supabase demo.

## Observed Request/Response Shapes

Captured against the live server (`v0.34.7`):

```text
GET  /api/records/v1/todos            -> {"total_count":0,"records":[]}
                                        {"records":[{"id":1,"title":"...","completed":0,"created_at":1792246450}],"cursor":"..."}
POST /api/records/v1/todos  {"title":"buy milk"}   -> 200 {"ids":["1"]}
GET  /api/records/v1/todos/1          -> {"id":1,"title":"buy oat milk","completed":1,"created_at":...}
PATCH/DELETE /api/records/v1/todos/1  -> 200
```

Realtime SSE (`subscribe/*`, the `*` path means "all changes"):

```text
: ping
data: {"Insert":{"id":2,"title":"...","completed":0,"created_at":1792246864},"seq":1}
data: {"Update":{"id":1,"title":"...","completed":1,"created_at":1792246852},"seq":2}
data: {"Delete":{"id":2,"title":"...","completed":0,"created_at":1792246864},"seq":3}
```

`src/trailbase.ts` subscribes with `EventSource` and, on any `data:` frame,
reloads the list — the same reload-on-change behavior the Supabase
(`postgres_changes`) and Nhost (`graphql-ws`) demos use.

## Project Files

- `src/App.tsx`: todo UI (identical to the Supabase demo) with TrailBase CRUD + realtime.
- `src/trailbase.ts`: fetch-based records API wrapper + `EventSource` realtime; normalizes `completed`/`created_at`.
- `src/styles.css`, `src/main.tsx`, `index.html`, `src/vite-env.d.ts`: shared UI assets, copied verbatim from `todo-demo-sb`.
- `vite.config.ts`: same-origin `/api` proxy to `127.0.0.1:4000`, with `X-Accel-Buffering: no` so SSE is not buffered.
- `traildepot/config.textproto`: record collection name, ACLs, `enable_subscriptions`.
- `traildepot/migrations/main/U1785000000__todos.sql`: the `todos` table.
- `traildepot/.gitignore`: ignores depot runtime state; keeps config + migrations tracked.
- `scripts/trailbase-start.sh`: IPv4-pinned `trail run` with `600`-mode log capture.
- `.env.local`: same-origin base (empty `VITE_TRAILBASE_URL`).

## What Was Tested

Verification ran in three layers, all on `trail` v0.34.7 in this Codespace.

### 1. App through the Vite proxy (:5175 — the exact path the browser uses)

- `bun install` and `bun run build` (`tsc -b && vite build`): passed.
- `GET /` (Vite) → `200`; `GET /api/healthcheck` → `200` / `Ok`.
- `GET /api/records/v1/todos/schema` → inferred JSON schema (`title` the only required field).
- `POST /api/records/v1/todos {"title":...}` → `200` `{"ids":[...]}`; `GET`/`PATCH`/`DELETE` by id round-tripped `title`/`completed`.
- Ordering `?order=-created_at` newest-first (rows created >1s apart); `?filter[completed]=1` server-side filter returned only completed rows.
- Realtime: one `subscribe/*` stream delivered `Insert`, `Update`, and `Delete` frames with incrementing `seq`, through the proxy.
- Migration `U1785000000__todos` applied on first boot; server logged `Listening on http://127.0.0.1:4000`.

### 2. Real browser end-to-end (Playwright + Chromium, two tabs)

A headless Chromium drove the running app at `http://localhost:5175/` with two
separate browser contexts (Tab A / Tab B) to prove realtime propagation without
manual reload. **14/14 checks passed with zero console errors, zero page errors,
and zero failed network requests:**

- App loads (title contains "todo"); add input present; UI renders the "Little Things" layout with the "Local TrailBase" badge (screenshots captured).
- Create in Tab A → row appears in A **and streams to B with no reload**.
- Toggle complete → `is-done` class in A **and streamed to B**.
- Filters: "To do" hides completed / shows open; "Done" shows only completed; "Everything" shows both.
- Delete in A → removed in A **and streamed to B**; empty-state renders when cleared.
- No in-app error banner (`.error-message`) at any step.

(The Playwright harness lives outside the project in a throwaway dir; the demo
itself has no test dependency. `networkidle` is not a usable wait condition here
because the app holds a permanent `EventSource` connection — wait on
`domcontentloaded` instead.)

### 3. TrailBase platform capabilities (separate probe depot, port 4001)

The demo uses only anonymous world access, but to confirm the installed
TrailBase is fully functional these were exercised against a throwaway depot
with an authenticated-only collection (`private_notes`) and a world-read-only
collection (`public_data`):

- **ACL gating (anonymous):** `GET`/`POST private_notes` → `403`; `POST public_data` → `403` (world is READ-only); `GET public_data` → `200`.
- **Auth:** `POST /api/auth/v1/login` (verified admin) → `auth_token` (370 chars) + `csrf_token` + `refresh_token`.
- **Authenticated CRUD:** with `Authorization: Bearer <token>`, `POST/GET/GET-by-id private_notes` → `200`; writing the READ-only collection → `403` (per-flag enforcement is exact).
- **Session lifecycle:** `POST /api/auth/v1/refresh` → new `auth_token`; `POST /api/auth/v1/logout` (with `x-csrf-token`) → `200`; `GET /api/auth/v1/status` → token object.
- **Password policy:** registration with a <8-char password → `400`; login with a wrong password → `401`.
- **Admin UI:** `GET /_/admin/` → `200`, serving the real `TrailBase Admin` SPA.
- **Backups:** `trail backups trigger` → "Backup succeeded" (wrote `backups/<ts>/`); `trail backups list` → listed it.

**Known environment limits (not failures):**

- `POST /api/auth/v1/register` returns **`424 Failed Dependency`** because
  password sign-up sends a verification email and no SMTP host is configured
  (the server logs `Falling back to local sendmail: Missing: SMTP host`). Use a
  verified user instead: `trail user add <email> <password>` **while the server
  is stopped** (the CLI opens the DB directly and hits a write-lock conflict
  against a running server), or configure `email` in `config.textproto`.
- Anonymous sign-in (`enable_anonymous_signin`) and the file-download endpoints
  (`/api/records/v1/{name}/{record}/file...`) exist but their exact client wire
  contracts (driven by the official `trailbase` JS SDK) were not exercised here.

Not exercised: OAuth providers, TOTP/MFA enrollment, email delivery, file
uploads, `attach`-ed databases, and WASM custom endpoints — all outside what the
demo uses.

## Failure And Diagnosis Timeline

1. **First boot rejected the collection.** With `id BLOB PRIMARY KEY DEFAULT
   (UUID_V7())`, startup logged: *"TABLE 'todos' referenced by API 'todos': Does
   not have a suitable PRIMARY KEY column ... requires PRIMARY KEYS to be of type
   INTEGER or UUID."* Fix: use `id INTEGER PRIMARY KEY`.
2. **Every proxied `/api` call returned `500`** while `curl localhost:4000`
   worked (`200`). The startup log said `Listening on http://[::1]:4000` —
   `localhost` resolved to **IPv6 only**, but the Vite proxy targeted
   `http://127.0.0.1:4000` (**IPv4**), so the proxy could not reach the backend.
3. **Pinning IPv4 fixed it.** Running `--address 127.0.0.1:4000` (and keeping the
   proxy on `127.0.0.1`) made list/schema/create/patch/delete and the SSE stream
   all return `200` through the proxy. `scripts/trailbase-start.sh` now defaults
   to `127.0.0.1:4000` for this reason.

## Logs And Troubleshooting

`bun run trailbase:debug` streams `trail run` to `trailbase-start.log` (mode
`600` — the first run contains the admin password). Do not commit or publish it.

```sh
tail -f trailbase-start.log
curl -s http://127.0.0.1:4000/api/healthcheck
curl -s http://localhost:5175/api/records/v1/todos?order=-created_at
```

Useful checks and gotchas:

- If proxied `/api` calls 500 but `:4000` works, compare the **address family**
  in the `Listening on http://...` line with the Vite proxy target. Bind and
  proxy on the same family (`127.0.0.1`).
- `WARN ... Vault not found. Falling back to empty default vault` on a fresh
  depot is expected; it is not an error and does not affect the demo.
- Realtime relies on a long-lived `text/event-stream`. If SSE frames never
  arrive, confirm the proxy is not buffering (the config sets
  `X-Accel-Buffering: no`).
- Changing a committed migration **after** it has run does not re-apply it
  (applied versions are tracked in the DB). For a clean slate while developing,
  stop the server and delete `traildepot/data/` (runtime state, gitignored).

## Stop And Preserve Data

Press `Ctrl+C` in each terminal to stop TrailBase and Vite. TrailBase keeps its
SQLite files under `traildepot/data/`, so restarting with
`bun run trailbase:debug` resumes with existing todos. To reset the data, delete
`traildepot/data/`.

## Differences From The Supabase And Nhost Demos

| Aspect | `todo-demo-sb` (Supabase) | `todo-demo-nh` (Nhost) | `todo-demo-tb` (TrailBase) |
| --- | --- | --- | --- |
| Backend runtime | Docker stack (Kong, PostgREST, Auth, Realtime, ...) | Docker stack (Hasura, Auth, ...) | Single native binary + embedded SQLite |
| Data access | PostgREST via `@supabase/supabase-js` | GraphQL via `@nhost/nhost-js` | REST records API via thin `fetch` wrapper |
| Realtime | `postgres_changes` WebSocket | `graphql-ws` subscription | SSE `EventSource` (`subscribe/*`) |
| Anonymous access | RLS policies `to anon` | Hasura public role | `acl_world` flags |
| Primary key | `bigint identity` | `Int` | `INTEGER` (BLOB PK rejected) |
| Client key | `ANON_KEY` in `.env.local` | GraphQL endpoint + role | none (same-origin, world ACL) |
| Networking fix needed | iptables bridge FORWARD rule | iptables bridge FORWARD rule | none (no container network) |
| Dev port | 5173 | 5174 | 5175 |
