#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Please ensure $ENV_FILE exists before deploying." >&2
  exit 1
fi

docker network inspect dtl-proxy >/dev/null 2>&1 || docker network create dtl-proxy >/dev/null

COMPOSE_ARGS=(-p platform --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if [[ -f "$ROOT_DIR/.env.identity" && -f "$ROOT_DIR/docker-compose.identity.yml" ]]; then
  COMPOSE_ARGS+=(--env-file "$ROOT_DIR/.env.identity" -f "$ROOT_DIR/docker-compose.identity.yml")
fi

echo "==> Building and deploying services..."
docker compose "${COMPOSE_ARGS[@]}" build
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans
docker compose "${COMPOSE_ARGS[@]}" ps

