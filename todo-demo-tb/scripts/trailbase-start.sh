#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# TrailBase is a single self-contained executable with an embedded SQLite
# database. Unlike the Supabase and Nhost demos, there is no Docker network to
# repair and no inter-container firewall rule to insert: this script just boots
# the server. The source-controlled depot (config.textproto + migrations) is
# committed; runtime state (data/, secrets/, ...) is created on first run.

# Bind explicitly to IPv4 (127.0.0.1), NOT the `localhost` default: on this host
# `localhost` resolves to ::1 and TrailBase then listens on IPv6 only, while
# Vite's proxy targets http://127.0.0.1:4000 (IPv4) and every /api request fails
# with a proxy 500. Pinning IPv4 on both sides keeps them in agreement.
address="${TB_ADDRESS:-127.0.0.1:4000}"

if ! command -v trail >/dev/null 2>&1; then
	cat >&2 <<'EOF'
ERROR: the `trail` CLI is not on your PATH.

Install the official TrailBase binary (installs to ~/.local/bin):

  curl -sSL https://trailbase.io/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"

Verify with:  trail --version
EOF
	exit 1
fi

# Make sure the depot's committed layout exists even on a fresh checkout.
mkdir -p traildepot/migrations/main

touch trailbase-start.log
chmod 600 trailbase-start.log

printf 'Starting TrailBase (embedded SQLite) on http://%s\n' "$address"
printf 'Depot:  %s/traildepot\n' "$PWD"
printf 'Admin UI: http://%s/_/admin/  (credentials are printed in the log)\n' "$address"
printf 'Log file: %s/trailbase-start.log\n\n' "$PWD"

# `trail run` is a long-lived foreground server, like `bun run dev`.
# Apply committed migrations, then serve. Ctrl+C to stop (data is preserved).
set +e
trail --depot ./traildepot run --address "$address" --stderr-logging 2>&1 \
	| tee trailbase-start.log
code=${PIPESTATUS[0]}
set -e

if [ "$code" -ne 0 ]; then
	printf '\nTrailBase exited with code %s. See trailbase-start.log (mode 600, may contain the admin password).\n' "$code" >&2
fi
exit "$code"
