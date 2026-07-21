#!/usr/bin/env bash
#
# backup.sh — Dumps the Chillberry prod Postgres DB to a gzip'd file and
# prunes old backups.
#
# Meant to run ON THE HOST (not inside a container) — it shells out to
# `docker exec` against the running Postgres container, it does not run
# inside docker-compose itself.
#
# Suggested cron line (daily at 3am, host crontab, NOT inside a container):
#   0 3 * * * POSTGRES_CONTAINER=chillberry-postgres-prod BACKUP_DIR=/var/backups/chillberry RETENTION_DAYS=14 /opt/chillberry/infra/scripts/backup.sh >> /var/log/chillberry-backup.log 2>&1
#
# NOTE: the backup filename timestamp MUST come from the shell's own `date`
# command (see below) — never hardcode a timestamp or compute it in a
# language runtime (e.g. `Date.now()` in Node) that isn't actually running
# on the host at execution time.
#
# Usage:
#   ./backup.sh [container-name]
#
# Env vars (all optional, all overridable):
#   POSTGRES_CONTAINER  Name of the running Postgres container.
#                       Default: chillberry-postgres-prod
#                       (Coordinate this with the actual container_name in
#                       infra/docker-compose.prod.yml once it's finalized —
#                       this is a guess based on the dev compose's
#                       chillberry-postgres-dev naming convention.)
#   BACKUP_DIR          Directory where backup files are written.
#                       Default: /var/backups/chillberry
#   RETENTION_DAYS      Backups older than this many days are deleted.
#                       Default: 14
#
# A positional argument (if given) overrides POSTGRES_CONTAINER, so both
# `POSTGRES_CONTAINER=foo ./backup.sh` and `./backup.sh foo` work.

set -euo pipefail

POSTGRES_CONTAINER="${1:-${POSTGRES_CONTAINER:-chillberry-postgres-prod}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/chillberry}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

POSTGRES_DB="chillberry"
POSTGRES_USER="chillberry"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/chillberry-backup-${TIMESTAMP}.sql.gz"

echo "[backup.sh] $(date -Iseconds) Starting backup of '${POSTGRES_DB}' from container '${POSTGRES_CONTAINER}' -> ${BACKUP_FILE}"

# Don't just trust a `pg_dump | gzip > file` pipe's overall exit code — a
# pipeline hides which stage actually failed (and `${PIPESTATUS[1]}` after
# a multi-process pipe has been observed to be unreliable across shells).
# Instead dump to an intermediate plain-SQL file first and check pg_dump's
# own exit status directly via `$?`, then gzip that file as a fully
# separate step and check *its* exit status directly too.
TMP_SQL_FILE="${BACKUP_FILE%.gz}"

# `--clean --if-exists`: el dump incluye los DROP antes de cada CREATE, así el
# restore funciona contra una base que YA tiene datos (recuperación real), no
# solo contra una base recién creada. Sin esto, restore.sh solo servía en el
# caso que nadie ejecuta jamás.
set +e
docker exec "$POSTGRES_CONTAINER" pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" > "$TMP_SQL_FILE"
PG_DUMP_EXIT=$?
set -e

if [ "$PG_DUMP_EXIT" -ne 0 ]; then
  echo "[backup.sh] ERROR: pg_dump failed (exit code ${PG_DUMP_EXIT}) against container '${POSTGRES_CONTAINER}'. Removing incomplete backup file." >&2
  rm -f "$TMP_SQL_FILE"
  exit 1
fi

set +e
gzip -f "$TMP_SQL_FILE"
GZIP_EXIT=$?
set -e

if [ "$GZIP_EXIT" -ne 0 ]; then
  echo "[backup.sh] ERROR: gzip failed (exit code ${GZIP_EXIT}) while compressing ${TMP_SQL_FILE}." >&2
  rm -f "$TMP_SQL_FILE" "$BACKUP_FILE"
  exit 1
fi

if [ ! -s "$BACKUP_FILE" ]; then
  echo "[backup.sh] ERROR: backup file ${BACKUP_FILE} is empty. Treating as a failed backup." >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

# `[ -s ]` solo dice "no está vacío" — un gzip truncado o corrupto lo pasa.
# `gzip -t` descomprime de verdad y valida el CRC: si el archivo está podrido,
# nos enteramos AHORA y no el día que lo necesitemos para restaurar.
set +e
gzip -t "$BACKUP_FILE"
GZIP_TEST_EXIT=$?
set -e
if [ "$GZIP_TEST_EXIT" -ne 0 ]; then
  echo "[backup.sh] ERROR: ${BACKUP_FILE} no pasa 'gzip -t' — el archivo está corrupto. Backup inválido." >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "[backup.sh] Backup OK: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

# --------------------------------------------------------------------------
# Copia OFFSITE — el punto más importante de este script.
#
# Un backup en /var/backups/chillberry está en el MISMO disco que el volume de
# Postgres: si el VPS muere o entra ransomware, se lleva la base Y el backup
# juntos. Eso no es un backup, es una copia. Y es multi-tenant: no perdés un
# restaurante, los perdés a TODOS a la vez.
#
# Se sube con rclone a un remote configurado (B2/R2/S3). Si RCLONE_REMOTE no
# está seteado, se avisa fuerte y se sigue —no se cae el backup local por no
# tener offsite— pero un backup solo-local NO es un backup válido para prod.
# --------------------------------------------------------------------------
if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "[backup.sh] Subiendo offsite a ${RCLONE_REMOTE}"
  set +e
  rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE" --no-traverse
  RCLONE_EXIT=$?
  set -e
  if [ "$RCLONE_EXIT" -ne 0 ]; then
    echo "[backup.sh] ERROR: la subida offsite falló (rclone exit ${RCLONE_EXIT}). El backup local existe pero NO hay copia externa." >&2
    exit 1
  fi
  echo "[backup.sh] Offsite OK."
else
  echo "[backup.sh] ADVERTENCIA: RCLONE_REMOTE no configurado — el backup queda SOLO en este host. Esto NO es válido para producción." >&2
fi

echo "[backup.sh] Pruning backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}"
find "$BACKUP_DIR" -maxdepth 1 -name 'chillberry-backup-*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete

# Dead-man's-switch: un ping a un monitor externo (healthchecks.io o similar).
# El backup que falla en silencio es peor que no tener backup, porque te da
# una falsa sensación de seguridad. Con esto, si el cron deja de correr o falla,
# el monitor avisa por no recibir el ping. Solo se pinguea si TODO salió bien
# (esta línea solo se alcanza con `set -e` activo y sin errores previos).
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null && echo "[backup.sh] Dead-man ping enviado."
fi

echo "[backup.sh] $(date -Iseconds) Done."
