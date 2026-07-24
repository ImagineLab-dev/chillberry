#!/usr/bin/env bash
#
# restore.sh — Restaura un backup en el Postgres que esta corriendo.
#
# FORMATOS:
#   chillberry-*.dump          (REAL: pg_dump -Fc de /opt/chillberry/backup.sh)
#   chillberry-backup-*.sql.gz (legacy: gunzip | psql)
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
#   ./restore.sh <path-al-backup(.dump|.sql.gz)> [container-name]
#
# Env vars:
#   POSTGRES_CONTAINER  Contenedor de Postgres. Default: se resuelve solo
#                       contra el swarm (docker ps -qf name=chillberry_postgres),
#                       que es como corre produccion hoy.

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <path-al-backup(.dump|.sql.gz)> [container-name]" >&2
  echo "  e.g.: $0 /opt/chillberry/backups/chillberry-20260722-0330.dump" >&2
  exit 1
fi

BACKUP_FILE="$1"
# Default: el contenedor real del stack swarm (task name con sufijo aleatorio).
DEFAULT_PG="$(docker ps --format '{{.Names}}' -f name=chillberry_postgres | head -1 || true)"
POSTGRES_CONTAINER="${2:-${POSTGRES_CONTAINER:-${DEFAULT_PG:-chillberry-postgres-prod}}}"
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
case "$BACKUP_FILE" in
  *.dump)
    # Formato REAL (-Fc). Integridad primero (pg_restore --list lee el TOC
    # entero), despues el restore con --clean --if-exists: sirve sobre base
    # con datos (las reemplaza) o fresca (los DROP son no-op).
    set +e
    docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$BACKUP_FILE" > /dev/null
    LIST_EXIT=$?
    set -e
    if [ "$LIST_EXIT" -ne 0 ]; then
      echo "[restore.sh] ERROR: el dump no pasa 'pg_restore --list' — archivo corrupto." >&2
      exit 1
    fi
    set +e
    docker exec -i "$POSTGRES_CONTAINER" pg_restore --clean --if-exists --no-owner \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$BACKUP_FILE"
    RESTORE_EXIT=$?
    set -e
    if [ "$RESTORE_EXIT" -ne 0 ]; then
      echo "[restore.sh] ERROR: pg_restore fallo (exit ${RESTORE_EXIT})." >&2
      exit 1
    fi
    echo "[restore.sh] $(date -Iseconds) Restore finished. Verify the app (e.g. infra/scripts/smoke-test.sh) before considering this done."
    exit 0
    ;;
esac

# ---- Rama LEGACY (.sql.gz): gunzip a archivo temporal + psql ----------------
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
