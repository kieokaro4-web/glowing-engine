#!/usr/bin/env bash
# Provision the Appwrite resources for todo-demo-aw AFTER you have completed the
# one-time Console onboarding (create the first admin account in the browser).
#
# Appwrite 2.5 self-hosted only grants the first user owner/admin rights through
# the Console web UI; there is no supported headless way to create that admin.
# Once it exists, everything below is plain REST and runs headlessly.
#
# Required env vars:
#   ADMIN_EMAIL       the email you created in the Console onboarding
#   ADMIN_PASSWORD    its password
#   ORGANIZATION_ID   shown in the Console URL after onboarding, e.g.
#                     https://<host>/organizations/6ad39c3b0003c393942d
# Optional overrides (defaults match src and .env.local):
#   PROJECT_ID DATABASE_ID TABLE_ID API_ORIGIN
set -euo pipefail

API="${API_ORIGIN:-http://127.0.0.1:80/v1}"
HOST_HDR="Host: localhost"            # Appwrite's Traefik routes by _APP_DOMAIN=localhost
PROJECT_ID="${PROJECT_ID:-todo-demo-aw}"
DATABASE_ID="${DATABASE_ID:-todos}"
TABLE_ID="${TABLE_ID:-todos}"

: "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"
: "${ORGANIZATION_ID:?set ORGANIZATION_ID}"
command -v jq >/dev/null || { echo "jq is required"; exit 1; }

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
proj=(--write-out '%{http_code}' --silent --show-error)
auth=(-H "$HOST_HDR" -H 'Content-Type: application/json' -H 'X-Appwrite-Project: console' -H 'Origin: http://localhost' -H "X-Appwrite-Organization: $ORGANIZATION_ID")
keyhdr=(-H "$HOST_HDR" -H 'Content-Type: application/json' -H 'X-Appwrite-Project: todo-demo-aw')

echo "==> Login as $ADMIN_EMAIL"
curl "${auth[@]}" -c "$JAR" "${proj[@]}" -o /dev/null \
  -X POST "$API/account/sessions/email" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null

echo "==> Create project $PROJECT_ID (ignore if it already exists)"
curl "${auth[@]}" -b "$JAR" -o /dev/null -w '%{http_code}\n' \
  -X POST "$API/organization/projects" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"name\":\"Todo Demo\",\"region\":\"default\"}"

echo "==> Create server API key 'provisioner'"
KEY=$(curl "${auth[@]}" -b "$JAR" -s \
  -X POST "$API/organization/projects/$PROJECT_ID/keys" \
  -d '{"keyId":"provisioner","name":"provisioner","scopes":["databases.read","databases.write","tables.read","tables.write","columns.read","columns.write","rows.read","rows.write"],"expire":null}' \
  | jq -r '.secret // "EXISTS"')
if [ "$KEY" = "EXISTS" ] || [ -z "$KEY" ]; then
  echo "   key already present; this script cannot re-read its secret."
  echo "   Create a fresh key in the Console (required scopes: tables/columns/rows read+write)"
  echo "   and re-run, or provision the table directly in the Console."
  exit 1
fi
keyhdr+=(-H "X-Appwrite-Key: $KEY")

echo "==> Create database $DATABASE_ID (tablesdb)"
curl "${keyhdr[@]}" -o /dev/null -w '%{http_code}\n' -X POST "$API/tablesdb" \
  -d "{\"databaseId\":\"$DATABASE_ID\",\"name\":\"Todos\"}"

echo "==> Create table $TABLE_ID (public Role.any, rowSecurity off)"
curl "${keyhdr[@]}" -o /dev/null -w '%{http_code}\n' -X POST "$API/tablesdb/$DATABASE_ID/tables" \
  -d "{\"tableId\":\"$TABLE_ID\",\"name\":\"Todos\",\"rowSecurity\":false,\"columns\":[],\"permissions\":[\"read(\\\"any\\\")\",\"create(\\\"any\\\")\",\"update(\\\"any\\\")\",\"delete(\\\"any\\\")\"]}"

echo "==> Add column title (string, required, max 180)"
curl "${keyhdr[@]}" -o /dev/null -w '%{http_code}\n' -X POST "$API/tablesdb/$DATABASE_ID/tables/$TABLE_ID/columns/string" \
  -d '{"key":"title","required":true,"array":false,"size":180}'

echo "==> Add column completed (boolean, default false)"
curl "${keyhdr[@]}" -o /dev/null -w '%{http_code}\n' -X POST "$API/tablesdb/$DATABASE_ID/tables/$TABLE_ID/columns/boolean" \
  -d '{"key":"completed","required":false,"default":false,"array":false}'

echo "==> Waiting for table to become available (worker finalizes schema)..."
for _ in $(seq 1 30); do
  status=$(curl "${keyhdr[@]}" -s "$API/tablesdb/$DATABASE_ID/tables/$TABLE_ID" | jq -r '.status')
  [ "$status" = "available" ] && break
  sleep 2
done
echo "   table status: $status"

echo
echo "Provisioned. Add these to .env.local (already set for the defaults):"
echo "  VITE_APPWRITE_ENDPOINT=http://localhost:5175/v1"
echo "  VITE_APPWRITE_PROJECT_ID=$PROJECT_ID"
echo "  VITE_APPWRITE_DATABASE_ID=$DATABASE_ID"
echo "  VITE_APPWRITE_TABLE_ID=$TABLE_ID"
