#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_dir="$(cd "$script_dir/.." && pwd)"
seed_file="$api_dir/seeds/local_webrtc_manual_test.sql"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required before running the local WebRTC seed script." >&2
  exit 1
fi

if [[ ! -f "$seed_file" ]]; then
  echo "Seed file not found: $seed_file" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run the local WebRTC seed script, but it was not found on PATH." >&2
  exit 1
fi

echo "Seeding local WebRTC manual test demo data..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$seed_file"
echo "Local WebRTC manual test demo data seeded."
