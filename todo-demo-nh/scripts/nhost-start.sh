#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."

project_name="todo-demo-nh"
network_name="${project_name}_default"

bunx @nhost/cli@1.52.0 down \
  --root-folder "$PWD" \
  --project-name "$project_name" \
  --local-subdomain local || true

if ! docker network inspect "$network_name" >/dev/null 2>&1; then
  docker network create --driver bridge \
    --label "com.docker.compose.project=$project_name" \
    --label com.docker.compose.network=default \
    "$network_name" >/dev/null
fi

network_id=$(docker network inspect --format '{{.Id}}' "$network_name")
bridge_iface="br-${network_id:0:12}"

docker run --rm --network host --cap-add NET_ADMIN \
  -e BRIDGE_IFACE="$bridge_iface" debian:bookworm-slim sh -ec '
    apt-get update -qq
    apt-get install -y -qq iptables >/dev/null
    # Stale iptables-legacy rules (left by an older dockerd backend) use a
    # FORWARD policy DROP that only whitelists docker0 and silently kills all
    # traffic on custom bridge networks. Pin the policy and hairpin ACCEPT.
    iptables-legacy -P FORWARD ACCEPT
    iptables-legacy -C FORWARD -i "$BRIDGE_IFACE" -o "$BRIDGE_IFACE" -j ACCEPT 2>/dev/null ||
      iptables-legacy -I FORWARD 1 -i "$BRIDGE_IFACE" -o "$BRIDGE_IFACE" -j ACCEPT
  '

touch nhost-start.log
chmod 600 nhost-start.log
printf 'Starting the full Nhost stack on %s (%s).\n' "$network_name" "$bridge_iface"
printf 'Log file: %s/nhost-start.log\n\n' "$PWD"

set +e
bunx @nhost/cli@1.52.0 up \
  --root-folder "$PWD" \
  --project-name "$project_name" \
  --local-subdomain local \
  --ca-certificates /etc/ssl/certs/ca-certificates.crt \
  --down-on-error 2>&1 | tee nhost-start.log
start_status=${PIPESTATUS[0]}
set -e

{
  printf '\n=== Nhost containers ===\n'
  docker ps -a --filter "name=${project_name}-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

  while IFS= read -r container; do
    printf '\n=== %s logs ===\n' "$container"
    docker logs --tail 80 "$container" 2>&1 || true
  done < <(docker ps -a --format '{{.Names}}' | grep "^${project_name}-" || true)
} | tee -a nhost-start.log

exit "$start_status"