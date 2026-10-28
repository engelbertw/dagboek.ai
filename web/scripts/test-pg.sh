#!/usr/bin/env bash
# Start een tijdelijke Postgres 16 in Docker, draai de tests in server/tests-pg ertegen en ruim alles op.
# Gebruikt alleen een wegwerpdatabase met een willekeurig wachtwoord; raakt nooit een echte database.
set -euo pipefail
cd "$(dirname "$0")/.."

NAAM="dagboek-test-pg-$$"
WACHTWOORD="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
trap 'docker rm -f "$NAAM" >/dev/null 2>&1 || true' EXIT

docker run -d --rm --name "$NAAM" -e POSTGRES_PASSWORD="$WACHTWOORD" -p 127.0.0.1::5432 postgres:16-alpine -c max_connections=200 >/dev/null
POORT="$(docker port "$NAAM" 5432/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 60); do
  docker exec "$NAAM" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$NAAM" pg_isready -U postgres >/dev/null

TEST_DATABASE_URL="postgres://postgres:${WACHTWOORD}@127.0.0.1:${POORT}/postgres" npx vitest run --config vitest.pg.config.ts "$@"
