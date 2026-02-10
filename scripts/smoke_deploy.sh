#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
MES="${2:-$(date +%Y-%m)}"

if [[ -z "$BASE_URL" ]]; then
  echo "Uso: ./scripts/smoke_deploy.sh https://seu-dominio [YYYY-MM]"
  exit 1
fi

echo "[1/4] Healthcheck"
curl -fsS "${BASE_URL}/api/health" >/dev/null
echo "OK"

echo "[2/4] Sync status"
curl -fsS "${BASE_URL}/api/sync/status?checkConnection=true" >/dev/null
echo "OK"

echo "[3/4] Sync run"
curl -fsS -X POST "${BASE_URL}/api/sync/run" >/dev/null
echo "OK"

echo "[4/4] Dashboard (${MES})"
curl -fsS "${BASE_URL}/api/dashboard?mes=${MES}" >/dev/null
echo "OK"

echo "Smoke deploy concluido com sucesso."
