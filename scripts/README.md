# Repository Validation Scripts

This directory contains small shell entrypoints that make it easier to validate the Djoko Studio monorepo before opening a pull request.

## `validate.sh`

Run the repository-wide validation workflow from the checkout:

```bash
./scripts/validate.sh
```

The script resolves the repository root automatically from its own location, then runs the currently available checks for:

- `apps/web-studio` with `npm ci` and `npm run build`
- `services/api` with `go test ./...`
- `services/signaling` with `go test ./...`
- `services/upload` with `cargo fmt --check`, `cargo test`, and `cargo check`
- `services/media-worker` with `cargo fmt --check`, `cargo test`, and `cargo check`
- `services/export-worker` with `cargo fmt --check`, `cargo test`, and `cargo check`

If `cargo clippy` is available locally, the script also runs:

- `cargo clippy -- -D warnings`

For the current scaffolded frontend, lint and test scripts are skipped because they are not defined in `apps/web-studio/package.json`.

The validator expects the relevant toolchains to be available on `PATH` and stops with a clear message if `Node.js`, `npm`, `go`, or `cargo` is missing.

A minimal GitHub Actions workflow at [`.github/workflows/validate.yml`](../.github/workflows/validate.yml) runs this same script on pull requests and pushes to `main`. It is validation only and does not handle deployment or release automation.
