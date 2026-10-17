#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run from the project root regardless of where this script is invoked.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Appwrite's compose stack spans four user-defined Docker networks. In this
# Codespace the legacy iptables FORWARD chain defaults to DROP and only allows
# the docker0 bridge, so containers on a custom bridge cannot reach each other
# (the same failure the Supabase demo hit). Pre-create the networks with stable
# names, derive each bridge interface, and insert an idempotent same-bridge
# ACCEPT rule before any container tries to talk.
NETWORKS=(appwrite gateway browser runtimes)
BRIDGES=()

for net in "${NETWORKS[@]}"; do
	if ! docker network inspect "$net" >/dev/null 2>&1; then
		docker network create --driver bridge "$net" >/dev/null
	fi
	id=$(docker network inspect --format '{{.Id}}' "$net")
	BRIDGES+=("br-${id:0:12}")
done

printf 'Appwrite Docker networks: %s\n' "${NETWORKS[*]}"
printf 'Bridge interfaces: %s\n' "${BRIDGES[*]}"

docker run --rm --network host --cap-add NET_ADMIN \
	-e BRIDGES="${BRIDGES[*]}" debian:bookworm-slim sh -ec '
		apt-get update -qq
		apt-get install -y -qq iptables >/dev/null
		for br in $BRIDGES; do
			iptables-legacy -C FORWARD -i "$br" -o "$br" -j ACCEPT 2>/dev/null ||
				iptables-legacy -I FORWARD 1 -i "$br" -o "$br" -j ACCEPT
		done
	'

# Start the stack with the project's own .env (local overrides) and a stable
# compose project name so volumes/networks persist across restarts.
cd appwrite
printf 'Starting the trimmed Appwrite stack (docker compose, project "appwrite").\n'
printf 'First run pulls several GB of images and can take several minutes.\n\n'

set +e
docker compose -p appwrite --env-file .env up -d 2>&1 | tee ../appwrite-start.log
up_status=${PIPESTATUS[0]}
set -e

# Wait for the Appwrite HTTP service to report healthy over plain HTTP. Traefik
# routes by Host, so send Host: localhost to match _APP_DOMAIN.
printf '\nWaiting for http://localhost/v1/health/version ...\n'
deadline=$((SECONDS + 300))
healthy=0
while [ $SECONDS -lt $deadline ]; do
	if curl -fsS -H 'Host: localhost' http://127.0.0.1:80/v1/health/version >/dev/null 2>&1; then
		healthy=1
		break
	fi
	sleep 5
done

{
	printf '\n=== Appwrite container status ===\n'
	docker compose -p appwrite ps
	printf '\n=== Appwrite /v1/health/version ===\n'
	curl -fsS -H 'Host: localhost' http://127.0.0.1:80/v1/health/version || true
} | tee -a ../appwrite-start.log

if [ "$healthy" -eq 1 ]; then
	printf '\nAppwrite is up and healthy on http://localhost (Host: localhost).\n'
else
	printf '\nAppwrite did not become healthy within 300s. See appwrite-start.log.\n'
fi

exit "$up_status"
