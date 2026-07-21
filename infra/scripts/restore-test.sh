#!/usr/bin/env bash
#
# restore-test.sh — Prueba que un backup se puede RESTAURAR de verdad.
#
# Un backup que nunca se restauró es una hipótesis, no un backup. Este script
# levanta un Postgres EFÍMERO (no toca nada de prod), restaura el dump más
# reciente adentro, y corre un smoke query. Si algo del dump está roto, se
# entera acá —en CI, un martes cualquiera— y no el día del incidente.
#
# Pensado para correr en CI (ver .github/workflows/ci.yml, job restore-test) o
# a mano en cualquier host con Docker. NO toca la base de producción: todo pasa
# en un contenedor descartable que se borra al final.
#
# Uso:
#   ./restore-test.sh [ruta-al-backup.sql.gz]
#   (sin argumento, toma el .sql.gz más reciente de BACKUP_DIR)
#
# Env:
#   BACKUP_DIR   Dónde buscar el backup si no se pasa ruta. Default: /var/backups/chillberry
#   PG_IMAGE     Imagen de Postgres para la prueba. Default: postgres:16-alpine

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/chillberry}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CONTAINER="chillberry-restore-test-$$"
DB="chillberry"
USER="chillberry"
PASSWORD="restore-test-throwaway"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'chillberry-backup-*.sql.gz' -type f | sort | tail -n1)"
fi
if [ -z "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
  echo "[restore-test] ERROR: no encontré un backup para probar (buscado en '${BACKUP_DIR}')." >&2
  exit 1
fi

echo "[restore-test] $(date -Iseconds) Probando restore de: ${BACKUP_FILE}"

# El contenedor efímero se borra pase lo que pase (éxito, fallo, Ctrl-C).
cleanup() { docker rm -f "$CONTAINER" > /dev/null 2>&1 || true; }
trap cleanup EXIT

# Antes que nada: el gzip tiene que estar íntegro.
if ! gzip -t "$BACKUP_FILE"; then
  echo "[restore-test] ERROR: ${BACKUP_FILE} no pasa 'gzip -t' — archivo corrupto." >&2
  exit 1
fi

echo "[restore-test] Levantando Postgres efímero (${PG_IMAGE})..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB="$DB" -e POSTGRES_USER="$USER" -e POSTGRES_PASSWORD="$PASSWORD" \
  "$PG_IMAGE" > /dev/null

echo "[restore-test] Esperando a que la base acepte conexiones..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$USER" -d "$DB" > /dev/null 2>&1; then break; fi
  if [ "$i" -eq 30 ]; then echo "[restore-test] ERROR: Postgres no arrancó en 30s." >&2; exit 1; fi
  sleep 1
done

echo "[restore-test] Restaurando el dump..."
# ON_ERROR_STOP=1: si CUALQUIER sentencia del dump falla, psql sale != 0 y el
# script se cae. Sin esto, un dump a medias "restauraría" con errores y
# reportaría éxito — el peor resultado posible en una prueba de backup.
gunzip -c "$BACKUP_FILE" | docker exec -i \
  -e ON_ERROR_STOP=1 "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" > /dev/null

echo "[restore-test] Smoke query: ¿las tablas core tienen estructura restaurable?"
# No verifica cantidad de filas (un backup válido puede ser de una base casi
# vacía) — verifica que las tablas fundamentales EXISTEN y son consultables,
# que es lo que prueba que el dump se aplicó de verdad.
for table in tenants users orders payments menu_items; do
  count="$(docker exec "$CONTAINER" psql -tAX -U "$USER" -d "$DB" -c "SELECT count(*) FROM \"${table}\";" 2>/dev/null || echo "FALLO")"
  if [ "$count" = "FALLO" ]; then
    echo "[restore-test] ERROR: la tabla '${table}' no existe tras el restore — el dump está incompleto." >&2
    exit 1
  fi
  echo "[restore-test]   ${table}: ${count} filas ✓"
done

echo "[restore-test] $(date -Iseconds) OK — el backup se restaura y las tablas core responden."
