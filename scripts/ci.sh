#!/usr/bin/env bash
# One command that says whether this repo is safe to merge.
#
#   scripts/ci.sh            lint, format, tests, mutation score   (about 1 minute)
#   scripts/ci.sh --docker   ...plus the Docker persistence and kill test
#   scripts/ci.sh --fast     lint, format and tests only           (a few seconds)
#
# The frontend (npm ci, lint, build) runs when frontend/ exists and npm is installed.
#
# Run it from anywhere. Exit status 0 means every step passed.
set -u
cd "$(dirname "$0")/../backend" || exit 2

mode="${1:-}"
failed=0
summary=""

step() {  # step "name" command...
  local name="$1"; shift
  printf '\n=== %s ===\n' "$name"
  if "$@"; then summary+="PASS  $name"$'\n'; else summary+="FAIL  $name"$'\n'; failed=1; fi
}

step "ruff check"        uv run ruff check .
step "ruff format"       uv run ruff format --check .
step "pytest"            uv run pytest
if [ "$mode" != "--fast" ]; then
  step "mutation score >= 95%" uv run python ../scripts/mutation_score.py --min 95
fi
if [ "$mode" = "--docker" ]; then
  step "docker persistence + kill test" python3 ../scripts/docker_check.py
fi

if [ -f ../frontend/package.json ]; then
  if command -v npm >/dev/null; then
    step "frontend npm ci"     npm --prefix ../frontend ci
    step "frontend lint"       npm --prefix ../frontend run lint
    step "frontend build"      npm --prefix ../frontend run build
  else
    summary+="SKIP  frontend checks (npm not found)"$'\n'
  fi
fi

printf '\n=== summary ===\n%s' "$summary"
exit "$failed"
