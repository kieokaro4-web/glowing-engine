#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."

network_name="todo-demo-supabase"
if ! docker network inspect "$network_name" >/dev/null 2>&1; then
	docker network create --driver bridge "$network_name" >/dev/null
fi

network_id=$(docker network inspect --format '{{.Id}}' "$network_name")
bridge_iface="br-${network_id:0:12}"

docker run --rm --network host --cap-add NET_ADMIN \
	-e BRIDGE_IFACE="$bridge_iface" debian:bookworm-slim sh -ec '
		apt-get update -qq
		apt-get install -y -qq iptables >/dev/null
		iptables-legacy -C FORWARD -i "$BRIDGE_IFACE" -o "$BRIDGE_IFACE" -j ACCEPT 2>/dev/null ||
			iptables-legacy -I FORWARD 1 -i "$BRIDGE_IFACE" -o "$BRIDGE_IFACE" -j ACCEPT
	'

printf 'Restarting the full local Supabase stack with debug logging.\n'
printf 'Docker network: %s (%s)\n' "$network_name" "$bridge_iface"
printf 'Log file: %s/supabase-start.log\n\n' "$PWD"
touch supabase-start.log
chmod 600 supabase-start.log

bunx supabase stop --agent no

set +e
bunx supabase start --agent no --network-id "$network_id" --debug 2>&1 | tee supabase-start.log
start_status=${PIPESTATUS[0]}
set -e

{
	printf '\n=== Supabase container status ===\n'
	docker ps -a --filter 'name=supabase_' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

	while IFS= read -r container; do
		printf '\n=== %s logs ===\n' "$container"
		docker logs --tail 80 "$container" 2>&1 || true
	done < <(docker ps -a --format '{{.Names}}' | grep '_todo-demo$' || true)
} | tee -a supabase-start.log

exit "$start_status"