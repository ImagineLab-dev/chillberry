#!/usr/bin/env bash
#
# restore.sh — Restores a chillberry-backup-*.sql.gz file (produced by
# backup.sh) into the running Postgres container.
#
# ============================================================================
# !!! DANGER !!!
# This OVERWRITES the target database with the contents of the backup file.
# Every row currently in the target `chillberry` database that isn't in the
# backup is GONE after this runs. There is no undo.
#
# NEVER run this against a production container without a human explicitly
# confirming first (see the interactive confirmation prompt below — it is
# not decorative, it is the only thing standing between this script and a
# production data loss incident). Do not pipe a hardcoded "CONFIRMAR" into
# this script's stdin in any automation — that defeats the entire point.
#
# El dump ahora se genera con `--clean --if-exists` (ver backup.sh), así que
# incluye los DROP antes de cada CREATE: se puede restaurar tanto en una base
# fresca (nuevo host / volume recreado) COMO en una que todavía tiene datos
# (los reemplaza). Ese es el punto del cambio: el caso "restaurar sobre lo que
# quedó" es el más común en un incidente real y antes fallaba con
# "already exists".
# ============================================================================
#
# Meant to run ON THE HOST (not inside a container) — it shells out to
# `docker exec -i` against the running Postgres container.
#
# Usage:
#   ./restore.sh <path-to-backup.sql.gz> [container-name]
#
# Env vars:
#   POSTGRES_CONTAINER  Name of the running Postgres container.
#                       Default: chillberry-postgres-prod
#                       (Same caveat as backup.sh: confirm this matches
#                       infra/docker-compose.prod.yml's container_name once
#                       that file is finalized.)

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <path-to-backup.sql.gz> [container-name]" >&2
  echo "  e.g.: $0 /var/backups/chillberry/chillberry-backup-20260717-030001.sql.gz" >&2
  exit 1
fi

BACKUP_FILE="$1"
POSTGRES_CONTAINER="${2:-${POSTGRES_CONTAINER:-chillberry-postgres-prod}}"
POSTGRES_DB="chillberry"
POSTGRES_USER="chillberry"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore.sh] ERROR: backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [ ! -s "$BACKUP_FILE" ]; then
  echo "[restore.sh] ERROR: backup file is empty: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "=============================================================="
echo " restore.sh — DESTRUCTIVE OPERATION"
echo "=============================================================="
echo " Backup file : ${BACKUP_FILE}"
echo " Target DB   : '${POSTGRES_DB}' inside container '${POSTGRES_CONTAINER}'"
echo ""
echo " This will OVERWRITE the target database. Data currently in"
echo " '${POSTGRES_DB}' that is not present in the backup will be lost."
echo "=============================================================="
echo ""

read -r -p "Esto va a sobreescribir la base de datos. Escribí 'CONFIRMAR' para continuar: " confirm

if [ "$confirm" != "CONFIRMAR" ]; then
  echo "[restore.sh] Confirmación no recibida (se esperaba 'CONFIRMAR' exacto). Abortando. Ningún cambio realizado." >&2
  exit 1
fi

echo "[restore.sh] $(date -Iseconds) Confirmado. Restaurando ${BACKUP_FILE} en '${POSTGRES_CONTAINER}'..."

# Don't just trust a `gunzip | docker exec psql` pipe's overall exit code —
# a pipeline hides which stage actually failed (and `${PIPESTATUS[1]}` after
# a multi-process pipe has been observed to be unreliable across shells).
# Un-gzip to a temp file first and check gunzip's own exit status directly
# via `$?`, then feed that plain file into psql as a fully separate step
# and check *its* exit status directly too.
TMP_SQL_FILE="$(mktemp)"
trap 'rm -f "$TMP_SQL_FILE"' EXIT

set +e
gunzip -c "$BACKUP_FILE" > "$TMP_SQL_FILE"
GUNZIP_EXIT=$?
set -e

if [ "$GUNZIP_EXIT" -ne 0 ]; then
  echo "[restore.sh] ERROR: gunzip failed (exit code ${GUNZIP_EXIT}) reading ${BACKUP_FILE}. Backup file may be corrupt." >&2
  exit 1
fi

# -v ON_ERROR_STOP=1 is required here: by default psql does NOT abort or
# return a non-zero exit code just because individual statements inside the
# script error out (e.g. "relation already exists") — it happily keeps
# going and exits 0 at the end, which would make this script report a
# successful restore even when it was actually partial/broken. With
# ON_ERROR_STOP=1, the first SQL error aborts the script and psql exits
# non-zero, so failures are actually caught below instead of silently
# swallowed.
set +e
docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB" < "$TMP_SQL_FILE"
PSQL_EXIT=$?
set -e

if [ "$PSQL_EXIT" -ne 0 ]; then
  echo "[restore.sh] ERROR: psql restore failed (exit code ${PSQL_EXIT}) against container '${POSTGRES_CONTAINER}'." >&2
  exit 1
fi

echo "[restore.sh] $(date -Iseconds) Restore finished. Verify the app (e.g. infra/scripts/smoke-test.sh) before considering this done."
