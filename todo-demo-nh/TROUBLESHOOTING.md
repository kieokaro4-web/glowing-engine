# Nhost Local Stack — Docker DNS/Networking Outage: Root Cause & Fix

Date: 2026-10-17 · Environment: GitHub Codespaces (Azure), Docker-in-Docker, `dockerd 29.8.0`

## Symptoms

- Nhost Functions crashed with `getaddrinfo EAI_AGAIN registry.npmjs.org` while Corepack/npm tried to install packages.
- Host could resolve and reach `https://registry.npmjs.org/` fine (HTTP 200).
- Containers on `todo-demo-nh_default` could not resolve **anything** — even `8.8.8.8` and `1.1.1.1` timed out.
- Containers on the **default** Docker bridge (`docker0`) worked perfectly.

## Root cause

It was **not** a DNS resolver-config problem. Two kernel netfilter rule-sets were live at the same time:

1. **nftables** — the rules the current daemon (`dockerd 29.x`, nft backend) manages. These were correct: proper `FORWARD` accepts and MASQUERADE for both `docker0` and the Nhost custom bridge `br-91c…`.
2. **iptables-legacy** — orphaned tables left behind by an **older dockerd** (legacy backend) earlier in this environment's life. Its `FORWARD` chain had **policy DROP** with allow rules referencing **only `docker0`**, and its `POSTROUTING` only masqueraded `172.17.0.0/16`.

Packets must pass through every registered forward hook. The legacy hook didn't know about the custom bridge network, so **every packet from the Nhost bridge was silently dropped before it ever reached NAT or the wire**. That killed UDP/TCP 53 (DNS) and all outbound traffic from Nhost containers — which surfaced as `EAI_AGAIN`. `docker0` containers worked because the legacy rules explicitly allowed them.

Secondary issues found along the way:

- `/etc/docker/daemon.json` was invalid JSON (a previous fix wrote literal `\n` sequences via `printf "%s\n"`), so it was never applied.
- UDP/53 to the Azure resolver `168.63.129.16` does not respond from this netns (a legacy `security` table pins Azure DNS to TCP for uid 0). Docker's embedded resolver handles this fine over TCP once routing works — no change needed.

## How it was diagnosed (repro steps)

```bash
# 1. Host resolves, container doesn't:
docker run --rm --network todo-demo-nh_default alpine:3.20 sh -ec 'nslookup -timeout=3 registry.npmjs.org'

# 2. It's not just DNS — ALL outbound from the Nhost bridge is dead,
#    while the default bridge works:
docker run --rm --network todo-demo-nh_default alpine:3.20 nc -z -w3 1.1.1.1 443   # FAIL
docker run --rm alpine:3.20 nc -z -w3 1.1.1.1 443                                  # OK

# 3. Daemon NAT/forward rules look correct in nftables — check for stale legacy tables.
#    (dockerd 29.x warns "iptables-legacy tables present" for exactly this reason.)
sudo nft list ruleset
sudo iptables-legacy -S            # FORWARD policy DROP, docker0-only rules  ← smoking gun
```

## The fix (applied on this host)

```bash
# 1. Back up, then flush the orphaned legacy filter/nat tables and pin policy ACCEPT.
#    Leave the legacy `security` table alone (Azure DNS guard) and don't touch dockerd.
sudo iptables-legacy-save > /tmp/iptables-legacy-backup.rules
sudo iptables-legacy -t filter -F
sudo iptables-legacy -P FORWARD ACCEPT
sudo iptables-legacy -t nat -F

# 2. Write valid daemon.json (used on future daemon restarts).
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "dns": ["168.63.129.16", "8.8.8.8"]
}
EOF

# 3. Restart the stack.
bash scripts/nhost-start.sh
```

Persistence: `scripts/nhost-start.sh` now runs `iptables-legacy -P FORWARD ACCEPT` inside its privileged helper on every start, so the stale policy DROP can never come back and bite the stack.

**Not done deliberately:** no TLS disabling, no npm registry bypass, no per-container `--dns` band-aids, no daemon-level DNS changes beyond valid config.

## App-side issues this outage was masking

Found while verifying end-to-end; all fixed:

1. **`todos` was never tracked in Hasura.** `nhost/metadata/databases/default/tables/tables.yaml` was missing the include, so every app GraphQL call would have returned `field 'todos' not found` even with working DNS. Fixed by adding:
   ```yaml
   - "!include public_todos.yaml"
   ```
2. **Wrong GraphQL endpoint path.** The app used Supabase-style `/v1/graphql`. Nhost local serves GraphQL at **`/v1`** — Traefik's `replace-graphql` middleware rewrites `/v1` → `/v1/graphql`; sending `/v1/graphql` gets rewritten to `/v1/graphqlgraphql` and 404s. Fixed:
   - `src/nhost.ts`: `graphqlUrl: \`${base}/graphql/v1\``
   - `.env.local`: `VITE_NHOST_GRAPHQL_WS_URL=ws://localhost:5174/nhost/graphql/v1`

## Verification checklist (all passed 2026-10-17)

```bash
# Container DNS + outbound on the Nhost bridge:
docker run --rm --network todo-demo-nh_default alpine:3.20 sh -ec \
  'getent hosts registry.npmjs.org && nc -z -w3 1.1.1.1 443'

# Full stack: 11 services, all health-checked services healthy, Functions logs free of EAI_AGAIN:
docker ps --format '{{.Names}}\t{{.Status}}' | grep todo-demo-nh

# App flow through the Vite proxy (query + mutations + graphql-ws subscription):
bun run dev   # http://localhost:5174
curl -s -H 'content-type: application/json' \
  -d '{"query":"{ todos { id title } }"}' http://localhost:5174/nhost/graphql/v1
```

## Config layout note (2026-10-17 consolidation)

The Nhost config directory was duplicated: a template copy sat at repo root
(`glowing-engine/nhost/`) and the live one mounted by the stack lives at
`todo-demo-nh/nhost/`. The root copy has been merged away — its email templates
(`emails/{bg,cs,en,es,fr,...}`) were copied into `todo-demo-nh/nhost/emails/`
(served to Auth via the bind mount `nhost/emails → /app/email-templates`), and
its stale `nhost.toml` (old `clientUrl = 'http://localhost:3000'`) was dropped in
favor of the live one (`:5174`). There is now exactly one `nhost/` directory:
`todo-demo-nh/nhost/`. Do not recreate a root-level `nhost/`; the CLI resolves
config from the project folder passed via `--root-folder`.

## If it recurs after a Codespace restart

Symptom = "containers on custom networks have no internet, but `docker0` works" → check `sudo iptables-legacy -S` for a `FORWARD` policy DROP again first; `nhost-start.sh` normally repairs it automatically at startup.
