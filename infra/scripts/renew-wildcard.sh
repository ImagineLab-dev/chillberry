#!/usr/bin/env bash
# Renueva el cert wildcard *.chillberry.app (lego v5 / DNS-01 Hostinger). En v5
# `run` hace "get OR renew": con LEGO_RENEW_DAYS=30 es NO-OP hasta que falten
# <30 días, y recién ahí re-emite (así no pega a Let's Encrypt cada corrida ni
# choca con sus rate limits). Al final toca el config de Traefik para que reléela
# el cert nuevo (Traefik observa el config, no los archivos de cert).
#
# Instalado en el server como /opt/chillberry/infra/scripts/renew-wildcard.sh y
# disparado por cron (lun y jue 03:30):
#   30 3 * * 1,4 /opt/chillberry/infra/scripts/renew-wildcard.sh >> /var/log/chillberry-cert-renew.log 2>&1
#
# El token de la API DNS de Hostinger NO vive acá: está en
# /opt/chillberry/infra/.hostinger-dns.env (root, 600) como HOSTINGER_API_TOKEN.
#
# ¿Por qué DNS-01 y no el certResolver HTTP-01 de Traefik? Porque HTTP-01 no
# puede emitir wildcards — sólo DNS-01. El cert emitido se guarda en
# /etc/easypanel/traefik/wildcard-certs/ y Traefik lo sirve por SNI desde
# `tls.certificates` (ver infra/traefik-chillberry.yaml).
set -euo pipefail
docker run --rm \
  --env-file /opt/chillberry/infra/.hostinger-dns.env \
  -e LEGO_EMAIL="soporte@chillberry.app" \
  -e LEGO_ACCEPT_TOS=true \
  -e LEGO_DNS=hostinger \
  -e LEGO_DOMAINS="*.chillberry.app" \
  -e LEGO_PATH=/data \
  -e LEGO_DNS_PROPAGATION_WAIT=240s \
  -e LEGO_RENEW_DAYS=30 \
  -v /etc/easypanel/traefik/wildcard-certs:/data \
  goacme/lego:latest run
touch /etc/easypanel/traefik/config/chillberry.yaml
