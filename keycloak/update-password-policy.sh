#!/usr/bin/env bash
# Run explicitly inside the Keycloak container; never during application startup.
set -euo pipefail
umask 077

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?Missing Keycloak bootstrap administrator}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?Missing Keycloak bootstrap password}"
config_dir=$(mktemp -d)
trap 'rm -f "$config_dir/kcadm.config"; rmdir "$config_dir"' EXIT
admin=/opt/keycloak/bin/kcadm.sh
config="$config_dir/kcadm.config"

"$admin" config credentials --config "$config" \
  --server http://127.0.0.1:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"

current_policy=$("$admin" get realms/dtl --config "$config" --fields passwordPolicy --format csv --noquotes)
if [[ "$current_policy" =~ (^|[[:space:]])length\([0-9]+\)($|[[:space:]]) ]]; then
  new_policy=$(printf '%s' "$current_policy" | sed -E 's/(^| and )length\([0-9]+\)($| and )/\1length(8)\2/g')
elif [[ -n "$current_policy" && "$current_policy" != 'null' ]]; then
  new_policy="length(8) and $current_policy"
else
  new_policy='length(8)'
fi

"$admin" update realms/dtl --config "$config" -s "passwordPolicy=$new_policy"
verified=$("$admin" get realms/dtl --config "$config" --fields passwordPolicy --format csv --noquotes)
if [[ "$verified" != "$new_policy" ]]; then
  printf '%s\n' 'Password policy verification failed.' >&2
  exit 1
fi
printf 'Password policy updated: %s\n' "$verified"
