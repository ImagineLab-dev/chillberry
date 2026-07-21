#!/usr/bin/env bash
#
# smoke-test.sh — Post-deploy smoke test for Chillberry.
#
# Hits the deployed stack (nginx -> api/web) over HTTP and checks that the
# whole request chain actually works end-to-end, not just that a process is
# listening on a port.
#
# Usage:
#   ./smoke-test.sh [base-url]
#
#   base-url defaults to http://localhost (for testing against a local
#   docker-compose.prod.yml stack on the same host). Pass a real staging/
#   prod URL to test a remote deploy, e.g.:
#     ./smoke-test.sh https://staging.chillberry.example.com
#
# Exits 0 only if every check passes; exits 1 if any check fails.

set -euo pipefail

BASE_URL="${1:-http://localhost}"
# Strip a trailing slash so "${BASE_URL}/api/..." doesn't end up with "//".
BASE_URL="${BASE_URL%/}"

PASS_COUNT=0
TOTAL_COUNT=0

check_status() {
  # check_status <label> <path> <expected-code> [extra-curl-args...]
  local label="$1"
  local path="$2"
  local expected="$3"
  shift 3
  local url="${BASE_URL}${path}"

  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" "$url" || echo "000")"

  if [ "$code" = "$expected" ]; then
    echo "PASS: ${label} (GET ${path} -> ${code})"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  else
    echo "FAIL: ${label} (GET ${path} -> ${code}, expected ${expected})"
    return 1
  fi
}

# (a) API liveness — process is up, no DB dependency.
check_status "API liveness" "/api/health/live" "200" || true

# (b) API readiness — proves DB connectivity (does SELECT 1 against Postgres).
check_status "API readiness (DB connectivity)" "/api/health/ready" "200" || true

# (c) Web frontend responds. "/" redirects (307) via middleware to /login or
# a role dashboard depending on the auth cookie, so this follows redirects
# (-L) and expects to land on 200, not a raw 307 on the root path.
check_status "Web frontend" "/" "200" -L || true

# (d) Public tracking endpoint against a bogus id — proves the full
# app+Prisma+Postgres request chain executes a real query end-to-end (a 404
# here means "reached the DB, found nothing", which is the correct, healthy
# response; a 500/timeout would mean the DB or app is actually broken).
# Deliberately NOT using /api/billing/plans here: that endpoint requires a
# valid JWT (no @Public(), and JwtAuthGuard is global — see
# apps/api/src/common/guards/rbac.module.ts), so an anonymous smoke test
# would always get 401 there regardless of app health.
check_status "Public tracking endpoint (DB round-trip)" "/api/track/00000000-0000-0000-0000-000000000000" "404" || true

echo ""
echo "${PASS_COUNT}/${TOTAL_COUNT} checks passed"

if [ "$PASS_COUNT" -ne "$TOTAL_COUNT" ]; then
  exit 1
fi

exit 0
