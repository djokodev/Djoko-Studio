#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_dir="$(cd "$script_dir/.." && pwd)"
migrations_dir="$api_dir/migrations"
goose_version="v3.27.1"
go_binary="${GO_BINARY:-go}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <goose-command> [args...]" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required before running API migration commands." >&2
  exit 1
fi

if [[ ! -d "$migrations_dir" ]]; then
  echo "Migrations directory not found: $migrations_dir" >&2
  exit 1
fi

if ! command -v "$go_binary" >/dev/null 2>&1; then
  if [[ -x /usr/local/go/bin/go ]]; then
    go_binary="/usr/local/go/bin/go"
  else
    echo "Go is required to run API migration commands, but it was not found." >&2
    exit 1
  fi
fi

command_name="$1"
shift

"$go_binary" run "github.com/pressly/goose/v3/cmd/goose@${goose_version}" \
  -dir "$migrations_dir" \
  postgres \
  "$DATABASE_URL" \
  "$command_name" \
  "$@"
