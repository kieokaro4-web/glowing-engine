#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Directus is fully self-hostable, so this demo runs the official Docker image
# with an embedded SQLite database. Unlike the Supabase demo there is a single
# container and no inter-container traffic, so no bridge-network firewall repair
# is needed. Data persists in ./directus across restarts.

image="directus/directus:11"
container="todo-demo-dt-directus"
host_port="${DIRECTUS_HOST_PORT:-8055}"
data_dir="$PWD/directus"

mkdir -p "$data_dir/database" "$data_dir/uploads" "$data_dir/extensions"

# SECRET signs tokens; a random default would invalidate everything on each
# restart, so keep it stable in a local file.
if [ ! -f "$data_dir/.secret" ]; then
	openssl rand -hex 32 > "$data_dir/.secret"
fi
secret="$(cat "$data_dir/.secret")"

admin_email="${DIRECTUS_ADMIN_EMAIL:-admin@example.com}"
admin_password="${DIRECTUS_ADMIN_PASSWORD:-admin-demo-password}"
admin_token="${DIRECTUS_ADMIN_TOKEN:-local-demo-admin-token}"

touch directus-start.log
chmod 600 directus-start.log

printf 'Restarting local Directus (%s) on http://127.0.0.1:%s\n' "$image" "$host_port"
printf 'SQLite data: %s/database  Log file: %s/directus-start.log\n\n' "$data_dir" "$PWD"

docker rm -f "$container" >/dev/null 2>&1 || true

docker run -d --name "$container" \
	-p "127.0.0.1:${host_port}:8055" \
	-e SECRET="$secret" \
	-e ADMIN_EMAIL="$admin_email" \
	-e ADMIN_PASSWORD="$admin_password" \
	-e ADMIN_TOKEN="$admin_token" \
	-e DB_CLIENT=sqlite3 \
	-e DB_FILENAME=/directus/database/data.db \
	-e PUBLIC_URL="http://127.0.0.1:${host_port}" \
	-e WEBSOCKETS_ENABLED=true \
	-e WEBSOCKETS_REST_AUTH="${DIRECTUS_WS_AUTH:-public}" \
	-e CORS_ENABLED=true \
	-e CORS_ORIGIN=http://localhost:5176,http://127.0.0.1:5176 \
	-v "$data_dir/database:/directus/database" \
	-v "$data_dir/uploads:/directus/uploads" \
	-v "$data_dir/extensions:/directus/extensions" \
	"$image" >> directus-start.log 2>&1

# First boot downloads the image and runs schema bootstrap; poll the unauthenticated healthcheck.
printf 'Waiting for Directus /server/ping '
ready=0
for _ in $(seq 1 120); do
	if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${host_port}/server/ping" 2>/dev/null || true)" = "200" ]; then
		ready=1
		break
	fi
	printf '.'
	sleep 2
done
printf '\n'

if [ "$ready" != "1" ]; then
	printf 'Directus did not become ready. Container logs:\n\n' >&2
	docker logs --tail 120 "$container" 2>&1 | tee -a directus-start.log
	exit 1
fi

DIRECTUS_URL="http://127.0.0.1:${host_port}" \
DIRECTUS_ADMIN_TOKEN="$admin_token" \
DIRECTUS_ADMIN_EMAIL="$admin_email" \
DIRECTUS_ADMIN_PASSWORD="$admin_password" \
	bun scripts/directus-bootstrap.ts 2>&1 | tee -a directus-start.log

{
	printf '\n=== Directus container status ===\n'
	docker ps --filter "name=$container" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
	printf '\n=== Recent Directus logs ===\n'
	docker logs --tail 60 "$container" 2>&1
} >> directus-start.log

printf 'Directus ready: http://127.0.0.1:%s (Studio at the same URL)\n' "$host_port"
printf 'Start the app in another terminal: bun run dev  ->  http://localhost:5176/\n'
