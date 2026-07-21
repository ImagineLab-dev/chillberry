#!/usr/bin/env bash
#
# preflight.sh — Pre-deploy sanity check. Run this BEFORE `docker compose up`
# in a fresh environment (new VPS, new staging box, etc).
#
# Usage:
#   ./preflight.sh [path-to-env-production-file]
#
#   Defaults to infra/.env.production (relative to the current working
#   directory — run this from the repo root, or pass an absolute path).
#
# Exits non-zero if ANY check fails.

set -euo pipefail

ENV_FILE="${1:-infra/.env.production}"

PASS_COUNT=0
TOTAL_COUNT=0
FAILED=0

pass() {
  echo "PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $1" >&2
  FAILED=1
}

check_start() {
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
}

# --- docker installed ---
check_start
if command -v docker >/dev/null 2>&1; then
  pass "docker is installed ($(docker --version 2>/dev/null | head -n1))"
else
  fail "docker is not installed or not on PATH"
fi

# --- docker compose installed ---
check_start
if docker compose version >/dev/null 2>&1; then
  pass "docker compose plugin is installed ($(docker compose version 2>/dev/null | head -n1))"
else
  fail "docker compose plugin is not available (tried: docker compose version)"
fi

# --- docker daemon reachable ---
check_start
if docker info >/dev/null 2>&1; then
  pass "docker daemon is reachable (docker info succeeded)"
else
  fail "docker daemon is not reachable (docker info failed — is the daemon running? does this user have permission?)"
fi

# --- .env.production exists ---
check_start
if [ -f "$ENV_FILE" ]; then
  pass "${ENV_FILE} exists"
else
  fail "${ENV_FILE} does not exist"
fi

# --- .env.production non-empty ---
check_start
if [ -f "$ENV_FILE" ] && [ -s "$ENV_FILE" ]; then
  pass "${ENV_FILE} is non-empty"
else
  fail "${ENV_FILE} is missing or empty"
fi

# --- required secrets present and not left as dev placeholders ---
# The dev .env.example templates use the literal placeholder strings
# "replace-me" (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET, see
# apps/api/.env.example) and "CHANGE_ME" as generic stand-ins. Shipping
# either literal string to production is a real security bug (well-known,
# guessable secret), so this must FAIL, not just warn.
REQUIRED_VARS="JWT_ACCESS_SECRET JWT_REFRESH_SECRET DATABASE_URL"

for VAR in $REQUIRED_VARS; do
  check_start
  if [ ! -f "$ENV_FILE" ]; then
    fail "${VAR}: cannot check — ${ENV_FILE} does not exist"
    continue
  fi

  LINE="$(grep -E "^${VAR}=" "$ENV_FILE" || true)"

  if [ -z "$LINE" ]; then
    fail "${VAR} is not set in ${ENV_FILE}"
    continue
  fi

  if printf '%s' "$LINE" | grep -qE 'replace-me|CHANGE_ME'; then
    fail "${VAR} still contains a dev placeholder value (replace-me / CHANGE_ME) in ${ENV_FILE} — this must be a real generated secret before deploying to production"
    continue
  fi

  pass "${VAR} is set in ${ENV_FILE} and does not contain a known placeholder"
done

echo ""
echo "${PASS_COUNT}/${TOTAL_COUNT} checks passed"

if [ "$FAILED" -ne 0 ]; then
  echo "preflight FAILED — fix the above before running docker compose up." >&2
  exit 1
fi

echo "preflight OK — safe to proceed with docker compose up."
exit 0
