#!/bin/bash
#
# Respaldo diario de la base y de las imágenes subidas.
#
# Se instala en /opt/chillberry/backup.sh y lo dispara cron. Ver docs/PRODUCCION.md.
#
# EL ORDEN IMPORTA Y ES DELIBERADO: primero se crea el respaldo nuevo, después
# se VERIFICA que sirva, y recién entonces se borran los viejos. Al revés —
# rotar primero para hacer lugar— un fallo del volcado deja cero respaldos, que
# es exactamente el escenario del que uno se quiere proteger.
#
# Tampoco se rota si el respaldo nuevo no pasó la verificación: es preferible
# quedarse con copias viejas que con ninguna.

set -euo pipefail

DIR=/opt/chillberry/backups
LOG=$DIR/backup.log
MARCA_EXITO=$DIR/ULTIMO-EXITO
ENV=/opt/chillberry/.env.prod

# Cuántos conservar. Con la base en 10 MB esto es irrelevante en disco, pero el
# límite existe igual: crecer sin techo termina en un disco lleno, y un disco
# lleno tira abajo Postgres, no sólo el respaldo.
DIARIOS=14
# Copias del día 1 de cada mes. Una corrupción que se descubre tarde no tiene
# arreglo si sólo se guardan dos semanas.
MENSUALES=6

mkdir -p "$DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Aviso por correo cuando algo falla. Un respaldo que dejó de correr y nadie se
# entera es igual a no tener respaldo — y el día que se necesita ya es tarde.
avisar_fallo() {
  local motivo="$1"
  log "FALLO: $motivo"
  # shellcheck disable=SC1090
  set -a; . "$ENV" 2>/dev/null || true; set +a
  [ -z "${SMTP_PASSWORD:-}" ] && return 0

  local cuerpo="/tmp/backup-alerta.$$"
  {
    echo "From: Chillberry <${MAIL_FROM:-soporte@chillberry.app}>"
    echo "To: ${MAIL_FROM:-soporte@chillberry.app}"
    echo "Subject: [Chillberry] Fallo el respaldo de la base"
    echo
    echo "El respaldo automatico fallo el $(date '+%d/%m/%Y a las %H:%M')."
    echo
    echo "Motivo: $motivo"
    echo
    echo "Ultimas lineas del log:"
    tail -15 "$LOG"
  } > "$cuerpo"

  # `|| true`: que no se pueda avisar no puede hacer fallar nada más.
  curl -s --url "smtps://${SMTP_HOST:-smtp.hostinger.com}:${SMTP_PORT:-465}" \
    --ssl-reqd --mail-from "${MAIL_FROM:-soporte@chillberry.app}" \
    --mail-rcpt "${MAIL_FROM:-soporte@chillberry.app}" \
    --user "${SMTP_USER}:${SMTP_PASSWORD}" \
    --upload-file "$cuerpo" >> "$LOG" 2>&1 || true
  rm -f "$cuerpo"
}

trap 'avisar_fallo "el script corto inesperadamente (linea $LINENO)"' ERR

PG=$(docker ps -qf name=chillberry_postgres | head -1)
[ -z "$PG" ] && { avisar_fallo "no se encontro el contenedor de Postgres"; exit 1; }

SELLO=$(date '+%Y%m%d-%H%M')
DUMP="$DIR/chillberry-$SELLO.dump"

log "--- inicio ---"

# `-Fc` (formato propio, comprimido) y no SQL plano: permite restaurar tablas
# sueltas y pesa mucho menos.
if ! docker exec "$PG" pg_dump -U chillberry -d chillberry -Fc > "$DUMP.parcial" 2>>"$LOG"; then
  rm -f "$DUMP.parcial"
  avisar_fallo "pg_dump devolvio error"
  exit 1
fi

# VERIFICAR ANTES DE ROTAR. Un archivo puede existir, pesar y estar corrupto;
# `pg_restore --list` lo lee de verdad y falla si el volcado esta truncado.
if ! docker exec -i "$PG" pg_restore --list < "$DUMP.parcial" > /dev/null 2>>"$LOG"; then
  rm -f "$DUMP.parcial"
  avisar_fallo "el volcado quedo corrupto (no paso pg_restore --list)"
  exit 1
fi

# Recién ahora pasa a ser un respaldo bueno. Renombrar es atómico: nunca queda
# un archivo a medio escribir con nombre definitivo.
mv "$DUMP.parcial" "$DUMP"
log "base respaldada: $(du -h "$DUMP" | cut -f1)"

# Imágenes que subió el restaurante. Van aparte porque viven en un volumen, no
# en la base, y perderlas significa que sus platos se quedan sin foto.
IMG="$DIR/uploads-$SELLO.tar.gz"
if docker run --rm -v chillberry_uploads:/u:ro -v "$DIR":/b alpine \
     tar czf "/b/$(basename "$IMG")" -C /u . 2>>"$LOG"; then
  log "imagenes respaldadas: $(du -h "$IMG" | cut -f1)"
else
  log "aviso: no se pudieron respaldar las imagenes (la base si)"
fi

# --- ROTACIÓN: sólo con un respaldo nuevo ya verificado en disco -------------

# El del día 1 se aparta como mensual antes de cualquier borrado.
if [ "$(date '+%d')" = "01" ]; then
  cp "$DUMP" "$DIR/mensual-$(date '+%Y%m').dump"
  log "copia mensual apartada"
fi

rotar() {
  local patron="$1" conservar="$2"
  # Se ordenan por nombre (llevan la fecha adelante), se saltean los que se
  # conservan y se borra el resto.
  local sobrantes
  sobrantes=$(ls -1 "$DIR"/$patron 2>/dev/null | sort -r | tail -n +$((conservar + 1)) || true)
  [ -z "$sobrantes" ] && return 0
  echo "$sobrantes" | while read -r viejo; do
    rm -f "$viejo"
    log "rotado: $(basename "$viejo")"
  done
}

rotar 'chillberry-*.dump' "$DIARIOS"
rotar 'uploads-*.tar.gz' "$DIARIOS"
rotar 'mensual-*.dump' "$MENSUALES"

# Red de seguridad final: si después de rotar no quedó ningún respaldo, algo
# está muy mal y hay que enterarse.
if [ "$(ls -1 "$DIR"/chillberry-*.dump 2>/dev/null | wc -l)" -eq 0 ]; then
  avisar_fallo "tras rotar no quedo NINGUN respaldo"
  exit 1
fi

date '+%Y-%m-%d %H:%M:%S' > "$MARCA_EXITO"
log "ok — $(ls -1 "$DIR"/chillberry-*.dump | wc -l) respaldos, $(du -sh "$DIR" | cut -f1) en total"
log "--- fin ---"
