# Local Supabase Todo Demo: Setup, Diagnostics, And Test Record

This document records how this demo is wired, how to start and verify it, what failed in this Codespace, what evidence identified the cause, what changed, and which commands were actually tested.

- **Validation date:** 2026-10-17
- **Environment:** Ubuntu 24.04.5 Codespace, Docker 29.8.0, Bun 1.4.3, Supabase CLI 2.121.0, PostgreSQL 17.11

## Scope

The app is React + Vite. Supabase CLI runs the local Supabase services in Docker. Browser requests go to Vite on port 5173; Vite proxies Supabase API and WebSocket paths to the Supabase Kong gateway on port 54321. The todo table is created by SQL migrations and accessed through PostgREST. Realtime broadcasts table changes to subscribed clients.

```text
Browser
  | HTTP / WebSocket, localhost:5173
  v
Vite same-origin proxy
  | localhost:54321
  v
Supabase Kong -> PostgREST / Auth / Storage / Realtime / Functions
  | Docker network hostname: supabase_db_todo-demo:5432
  v
Supabase PostgreSQL
```

The Vite proxy avoids depending on the browser's ability to resolve Docker-only service names. It forwards `/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1`, and `/realtime/v1` to Kong.

This is a local development stack, not a production deployment. The demo's `public.todos` policies deliberately grant anonymous users insert, update, and delete access. Do not reuse those policies or local keys in a hosted project.

## Prerequisites And Versions

- Bun is installed and available on `PATH`.
- Docker and its daemon are available.
- Run `bun install` once from this directory.
- `bunx supabase --version` reported `2.121.0` during this validation.

No npm or npx commands are required. The host did **not** have `psql`, `pgcli`, `pg_dump`, or `pg_restore` on `PATH`. The Supabase database container does contain `psql 17.11`; Supabase CLI database commands also worked without installing host PostgreSQL tools.

## Start The Stack

Start the Supabase stack in one terminal:

```sh
cd /workspaces/glowing-engine/todo-demo
bun run supabase:debug
```

This is a project helper, not merely a log wrapper. It:

1. Creates or reuses the stable external Docker network `todo-demo-supabase`.
2. Derives that network's bridge interface name.
3. Uses a temporary host-networked Debian container with `NET_ADMIN` to ensure one legacy iptables forwarding rule exists for traffic entering and leaving that same bridge.
4. Runs `bunx supabase stop --agent no`, which stops local Supabase containers but preserves their data volume.
5. Runs the full `bunx supabase start --agent no --network-id <network-id> --debug`, with no `--exclude` list.
6. Saves CLI output, container status, and the last 80 lines of each project service log to `supabase-start.log`.

The first run can take time while Docker downloads images. This helper restarts the stack on each invocation; it is safe for the local data volume but will disconnect current clients. It needs permission to run the temporary container with host networking and `NET_ADMIN`. If Codespaces or Docker removes that capability, the helper will fail while setting up the firewall rule.

Start Vite in a second terminal:

```sh
cd /workspaces/glowing-engine/todo-demo
bun run dev
```

Open <http://localhost:5173/>.

### Enabled And Optional Services

The full CLI stack started with the project's configured services: PostgreSQL, Kong, PostgREST, Auth, Realtime, Storage, Edge Runtime, Studio, Mailpit, pg-meta, Vector, and Analytics. `supabase status` also reported `imgproxy` and `supavisor` as stopped; those are optional here because image transformation is not enabled and `[db.pooler].enabled` is `false`. This is the CLI's configured local stack, not every hosted Supabase product.

## URLs And Local Key

| Service | URL or connection |
| --- | --- |
| Todo app | <http://localhost:5173/> |
| Supabase API gateway | <http://127.0.0.1:54321/> |
| REST | <http://127.0.0.1:54321/rest/v1/> |
| Auth health | <http://127.0.0.1:54321/auth/v1/health> |
| Studio | <http://127.0.0.1:54323/> |
| Mailpit | <http://127.0.0.1:54324/> |
| PostgreSQL | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

With Supabase running, the CLI provides the current local keys and URLs:

```sh
bunx supabase status --agent no -o env
```

Copy `ANON_KEY` to `VITE_SUPABASE_ANON_KEY` in `.env.local`. The CLI's `API_URL` is `http://127.0.0.1:54321`, but this app sets `VITE_SUPABASE_URL` to `http://127.0.0.1:5173` so browser calls remain same-origin and use Vite's proxy. `.env.local` is ignored by Git. Never put `SERVICE_ROLE_KEY` in browser code. The anon key is intentionally client-visible; RLS is what restricts its access.

The startup log can contain local API credentials. The debug script sets its mode to `600` before writing. Do not publish or commit it.

## Project Files

- `src/App.tsx`: todo UI and Supabase CRUD / Realtime subscription.
- `src/supabase.ts`: Supabase client and todo type.
- `vite.config.ts`: same-origin HTTP and WebSocket proxy to Kong.
- `supabase/config.toml`: local Supabase service and Auth configuration.
- `supabase/migrations/20261017000000_create_todos.sql`: table, RLS, grants, and demo policies.
- `supabase/migrations/20261017001000_publish_todos_to_realtime.sql`: adds `public.todos` to the Realtime publication.
- `scripts/supabase-debug.sh`: stable network setup, full-stack restart, debug log capture, and service log collection.
- `.env.local`: ignored Vite URL and anon key.

## What Was Tested

The results below distinguish successful commands from expected warnings and things that were not tested.

### App And HTTP Services

- `bun run build`: passed (`tsc -b` and Vite production build).
- `GET http://127.0.0.1:5173/`: returned `200`.
- `GET /rest/v1/todos` through Vite with the local anon key: returned `200` and an empty JSON array when the smoke-test rows had been cleaned up.
- `POST /rest/v1/todos`: returned `201` and a row containing `id`, `title`, `completed`, and `created_at`.
- `DELETE /rest/v1/todos?title=eq.<unique-title>`: returned `204`.
- `GET /auth/v1/health`: returned `200`.
- Authenticated local `GET /storage/v1/bucket`: returned `200`.
- `GET /realtime/v1/api/ping`: returned `200`.
- Studio returned `307`, an expected redirect to its UI route; Mailpit returned `200`.
- Docker showed PostgreSQL, Kong, Auth, Storage, Realtime, Studio, Mailpit, Vector, and Analytics healthy. PostgREST and Edge Runtime were running; they do not report Docker health checks in this configuration.

### Realtime

The first client smoke test timed out while joining a `postgres_changes` channel. The WebSocket proxy itself upgraded successfully, and the Realtime service was healthy. A catalog query then showed no tables in the `supabase_realtime` publication. After adding migration `20261017001000_publish_todos_to_realtime.sql`, the CLI applied it and the repeated client test reported `realtime subscribed` and `PASS realtime delivered insert`. The test deleted its temporary row afterward.

### Supabase Database CLI

These commands were run against the local database, not a linked cloud project:

| Command | Observed result |
| --- | --- |
| `bunx supabase migration list --local --agent no` | Listed both migrations, `20261017000000` and `20261017001000`, as applied locally. |
| `bunx supabase db lint --local --schema public --fail-on error --agent no` | `No schema errors found`. |
| `bunx supabase db advisors --local --type all --fail-on error --agent no` | Ran successfully; reported three expected `rls_policy_always_true` warnings for public insert, update, and delete policies. |
| `bunx supabase db query --local --agent no "<read-only SQL>"` | Ran a CTE joining PostgreSQL catalogs and returned table columns, RLS state, and policy names/roles. It reported RLS enabled, four policies, and columns `id bigint`, `title text`, `completed boolean`, `created_at timestamptz`. |
| `bunx supabase db dump --local --schema public --file <path> --agent no` | Wrote a 3,602-byte public schema dump containing the todo table, check/primary-key constraints, policies, and RLS enablement. |

The first dump assertion searched for unquoted `CREATE TABLE public.todos` and did not match. Inspecting the output showed valid pg_dump quoting: `CREATE TABLE IF NOT EXISTS "public"."todos"`. The corrected assertion passed. This was a test-pattern mismatch, not a dump failure.

CLI help was checked for `db query`, `db lint`, `db advisors`, `db dump`, `migration list`, and `test db`. The pgTAP runner itself was **not** run: this project has no pgTAP test files. Commands requiring a linked remote project, such as linked `db push` or `db pull`, were not tested. This is not a claim that every Supabase CLI or PostgreSQL command was exercised.

For direct SQL without installing host `psql`, the container client is available:

```sh
docker exec supabase_db_todo-demo psql -U postgres -d postgres -c 'select version();'
```

## Auth UI Versus Local Capabilities

Local Studio is not a full copy of the hosted Dashboard. A missing menu does not prove the local Auth service lacks the corresponding capability. The local CLI configuration documents settings for OAuth providers, redirect URLs, email templates/notifications, rate limits, Auth hooks, MFA, and passkeys/WebAuthn. They may need configuration through `supabase/config.toml`, SQL, or the Auth API. Local email is captured by Mailpit. OAuth apps themselves are registered with the external identity provider.

Other features can depend on hosted control-plane services or integrations. Check the feature-specific docs for OAuth-server management, hosted audit/performance reporting, and attack-protection integrations. Do not infer full local support from a related Auth setting. See the [local CLI configuration reference](https://supabase.com/docs/guides/local-development/cli/config).

Auth health was tested; user sign-up, provider OAuth redirects, email delivery flows, MFA enrollment, and passkey ceremonies were not. In particular, the generated config still has its default Auth `site_url` of port 3000, while this Vite app uses 5173. Update `auth.site_url` and `auth.additional_redirect_urls` before testing browser-based redirects. No auth UI is implemented in the todo app.

## Failure And Diagnosis Timeline

This section records observations separately from the conclusion.

1. **Initial CLI startup failed during service initialization.** PostgreSQL initialized, but the CLI exited with `DbSetupError`. Realtime logs showed `tcp connect (supabase_db_todo-demo:5432): timeout`; Storage reported `timeout expired`; PostgREST later reported timeouts to the same database hostname.
2. **The database itself was reachable from the Codespace.** Docker marked `supabase_db_todo-demo` healthy; `pg_isready` inside the DB passed; TCP to the published host port `54322` succeeded. Available memory was about 5.2 GiB with 2 CPUs. These observations do not support a memory shortage as the cause.
3. **Other bridge containers could not reach the DB.** A temporary client on the Supabase bridge returned `no response` for `supabase_db_todo-demo:5432`. A temporary client using Docker host networking could connect to both `127.0.0.1:54322` and the DB's `172.18.0.2:5432` bridge address.
4. **The active firewall backend explained the difference.** The `iptables` nft view was misleading and warned that legacy tables existed. Inspecting `iptables-legacy` showed `FORWARD` policy `DROP`; its allow rules covered `docker0`, not Supabase's custom bridge. The Codespace user could not inspect those host rules directly, but a temporary host-networked Docker container with `NET_ADMIN` could.
5. **A one-off rule proved the diagnosis.** Inserting `-i <bridge> -o <bridge> -j ACCEPT` for the current Supabase bridge made `pg_isready` from a bridge-attached container succeed. A subsequent stop/start generated another bridge interface, so that one-off rule did not follow the new interface.
6. **The helper made the repair repeatable.** It creates/reuses `todo-demo-supabase`, passes that network ID to the unexcluded Supabase CLI start, derives its `br-...` interface, and idempotently inserts the same-bridge allow rule before startup. Container-to-database connectivity passed on that stable network; all configured services then became healthy.
7. **Realtime needed an independent schema fix.** Once networking worked, the WebSocket proxy opened, but the client subscription still timed out because `public.todos` was absent from the Realtime publication. The second migration fixed publication membership; the repeated insert subscription passed.

### Hypotheses That Did Not Fix It

- Excluding Realtime or Storage, and disabling those services, did not fix the bridge route.
- Switching PostgreSQL from version 17 to 15 did not fix it; the generated CLI config restored version 17.
- Re-running `supabase init --force` with canonical config defaults did not fix it.
- More memory was not indicated by the healthy DB and direct-host connectivity evidence.

The reliable command in this Codespace is `bun run supabase:debug`, which uses the stable network and firewall rule. A plain `bunx supabase start` does not perform that environment-specific network repair.

## Logs And Troubleshooting

`bun run supabase:debug` streams `supabase start --debug` to the terminal, then appends Docker container status and the last 80 lines from each project container. The log path is `todo-demo/supabase-start.log`; the script sets permissions to `600` because CLI output may contain credentials.

```sh
tail -f supabase-start.log
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs --tail 100 supabase_db_todo-demo
docker logs --tail 100 supabase_rest_todo-demo
docker logs --tail 100 supabase_realtime_todo-demo
```

Useful patterns in the original failure were `DbSetupError`, `timeout expired`, and `tcp connect (...:5432): timeout`. A healthy PostgreSQL container alone is insufficient; check that another container on `todo-demo-supabase` can reach `supabase_db_todo-demo:5432`.

Startup may print `no files matched pattern: supabase/seed.sql`; the generated config references this optional seed path, but this project has no seed file. It did not prevent migrations or startup. Add the file or disable `[db.seed]` if seeds are not used.

The CLI may report `imgproxy` and `supavisor` stopped. This is expected with image transformation and the DB pooler disabled in the current config; it is not the earlier bridge failure.

The bridge rule modifies the Codespace Docker host's legacy forwarding table via a short-lived privileged-capability container. It is limited to traffic whose input and output interface are that Supabase bridge. The CLI separately publishes its configured ports. Do not copy this host-specific workaround to production infrastructure without reviewing its network policy.

## Stop And Preserve Data

```sh
bunx supabase stop --agent no
```

This stops the local Supabase containers but preserves the Docker data volume. `bun run supabase:debug` also stops before restarting. Stop Vite separately with `Ctrl+C` in its terminal.