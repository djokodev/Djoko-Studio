#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ ! -f "$repo_root/AGENTS.md" || ! -f "$repo_root/FEATURE_TRACKER.md" || ! -d "$repo_root/apps" || ! -d "$repo_root/services" ]]; then
  echo "Unable to confirm the Djoko Studio repository root from: $script_dir" >&2
  echo "Run this script from the repository checkout that contains AGENTS.md and FEATURE_TRACKER.md." >&2
  exit 1
fi

section() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  local command_name="$1"
  local message="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$message" >&2
    exit 1
  fi
}

has_npm_script() {
  local script_name="$1"
  node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scriptName = process.argv[1];
process.exit(pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, scriptName) ? 0 : 1);
' "$script_name"
}

require_command node "Node.js is required for frontend validation, but it was not found on PATH."
require_command npm "npm is required for frontend validation, but it was not found on PATH."

section "Frontend validation: apps/web-studio"
(
  cd "$repo_root/apps/web-studio"

  if [[ -f package-lock.json ]]; then
    echo "Installing frontend dependencies with npm ci"
    npm ci
  else
    echo "Skipping npm ci because package-lock.json is missing"
  fi

  if has_npm_script build; then
    echo "Running npm run build"
    npm run build
  else
    echo "Skipping npm run build because the build script is missing"
  fi

  if has_npm_script lint; then
    echo "Running npm run lint"
    npm run lint
  else
    echo "Skipping npm run lint because no lint script is defined"
  fi

  if has_npm_script test; then
    echo "Running npm test"
    npm test
  else
    echo "Skipping npm test because no test script is defined"
  fi
)

require_command go "Go is required for services/api and services/signaling validation, but it was not found on PATH."

section "Go validation: services/api"
(
  cd "$repo_root/services/api"
  go test ./...
)

section "Go validation: services/signaling"
(
  cd "$repo_root/services/signaling"
  go test ./...
)

require_command cargo "Rust cargo is required for services/upload, services/media-worker, and services/export-worker validation, but it was not found on PATH."

validate_rust_service() {
  local service_dir="$1"
  section "Rust validation: $service_dir"
  (
    cd "$repo_root/$service_dir"
    cargo fmt --check
    cargo test
    cargo check

    if cargo clippy --help >/dev/null 2>&1; then
      echo "Running cargo clippy -- -D warnings"
      cargo clippy -- -D warnings
    else
      echo "Skipping cargo clippy because it is not available in this environment"
    fi
  )
}

validate_rust_service "services/upload"
validate_rust_service "services/media-worker"
validate_rust_service "services/export-worker"

section "Validation complete"
echo "All available repository validation checks passed."
