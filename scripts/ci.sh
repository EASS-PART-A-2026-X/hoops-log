#!/usr/bin/env bash
# One command that says whether this repo is safe to merge.
#
#   scripts/ci.sh            lint, format, tests, mutation score   (about 1 minute)
#   scripts/ci.sh --docker   ...plus the Docker persistence and kill test
#   scripts/ci.sh --fast     lint, format and tests only           (a few seconds)
#
# The frontend runs when frontend/ exists: npm ci, lint, tests and build, or only lint with --fast.
# A missing npm is a SKIP on a laptop and a FAIL when CI=true (GitHub sets it).
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
    if [ "$mode" = "--fast" ]; then
      # Quick mode: lint only, and only when dependencies are already installed.
      if [ -d ../frontend/node_modules ]; then
        step "frontend lint"   npm --prefix ../frontend run lint
      else
        summary+="SKIP  frontend lint (run npm ci in frontend/ once)"$'\n'
      fi
    else
      step "frontend npm ci"   npm --prefix ../frontend ci
      step "frontend lint"     npm --prefix ../frontend run lint
      step "frontend tests"    npm --prefix ../frontend test
      step "frontend build"    npm --prefix ../frontend run build
    fi
  elif [ "${CI:-}" = "true" ]; then
    # On GitHub a missing npm means the Node setup is broken: that must fail.
    summary+="FAIL  frontend checks (npm not found in CI)"$'\n'; failed=1
  else
    summary+="SKIP  frontend checks (npm not found)"$'\n'
  fi
fi

printf '\n=== summary ===\n%s' "$summary"
exit "$failed"
