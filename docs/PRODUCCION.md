# Producción — servidor 72.60.51.162

**Chillberry está desplegado y funcionando en https://chillberry.app.** Este
documento es el runbook: cómo está armado y cómo actualizarlo.

## Lo primero que tenés que saber

**Ese servidor no es sólo tuyo de Chillberry.** Corre además:

- `n8n` + `evolution-api` (+ 2 Postgres) — tu automatización de WhatsApp
- `crm` / `crm_ortobom` (`imagine-crm` + MySQL) — CRM en producción
- `imaginelab-*` — landing, downloads y license-server de la agencia
- `traefik` — el proxy que comparten **todos**, Chillberry incluido

Chillberry se integró sin tocar nada de eso: no publica puertos al host, no
modifica la configuración de Traefik de los otros, y su Postgres y su Redis
quedan en una red overlay `internal: true` que ningún otro proyecto alcanza.

Antes de cualquier cambio en Traefik o en Docker, acordate de que un error ahí
no rompe sólo Chillberry.

## Cómo está armado

```
internet
   │
   ▼ 80/443
traefik  ─── /etc/easypanel/traefik/config/chillberry.yaml
   │
   ├── Host(chillberry.app) && PathPrefix(/api | /socket.io)  → chillberry-api:3001
   └── Host(chillberry.app) || Host(www.chillberry.app)       → chillberry-web:3000

stack `chillberry` (Docker Swarm)
   ├── web       red: easypanel            alias chillberry-web
   ├── api       redes: easypanel + interna, alias chillberry-api, volumen uploads
   ├── osrm      red: interna (aislada)     motor de ruteo, datos en /opt/osrm/data
   ├── postgres  red: interna (aislada)     volumen postgres-data
   └── redis     red: interna (aislada)     volumen redis-data
```

## Base nueva: los planes hay que sembrarlos

Las migraciones crean la estructura, **no los datos**. Sin al menos un plan
activo, el alta de cuenta consume el código de verificación, después busca el
plan de entrada, no lo encuentra y tira 404. El usuario queda con el código
quemado y sin restaurante.

Pasó en el primer alta real, el 21/07/2026. Es un paso obligatorio en cualquier
base nueva:

```bash
docker exec -i $(docker ps -qf name=chillberry_postgres)   psql -U chillberry -d chillberry < apps/api/prisma/seed-plans.sql
```

Es idempotente. NO uses `prisma/seed.ts`: ese crea además el restaurante de
demostración con datos de prueba.

## Respaldos

`infra/backup.sh`, instalado en `/opt/chillberry/backup.sh` y disparado por cron
todos los días a las 03:30 (el local ya cerró y nadie está cobrando).

Guarda **la base** (`pg_dump -Fc`, comprimido y con restauración selectiva) y
**las imágenes** que suben los restaurantes, que viven en un volumen aparte.

Conserva **14 diarios** y **6 mensuales** (copia del día 1). Con la base en
10 MB eso es irrelevante en disco, pero el techo existe igual: crecer sin
límite termina en un disco lleno, y un disco lleno tira abajo Postgres, no sólo
el respaldo.

**El orden es deliberado**: crear → verificar → recién ahí rotar. Al revés
—borrar viejos para hacer lugar— un fallo del volcado deja cero respaldos, que
es justo el escenario del que uno se quiere proteger. Si el volcado nuevo no
pasa la verificación (`pg_restore --list`, que lo lee de verdad y detecta un
archivo truncado), no se borra nada.

Si algo falla, **llega un mail a soporte@chillberry.app**. Un respaldo que dejó
de correr y nadie se entera es igual a no tener respaldo.

### Restaurar

```bash
# Ver qué hay
ls -lh /opt/chillberry/backups/

# Restaurar en una base de PRUEBA primero — nunca directo sobre la de producción
pg=$(docker ps -qf name=chillberry_postgres | head -1)
docker exec $pg psql -U chillberry -d postgres -c "CREATE DATABASE prueba_restore;"
docker exec -i $pg pg_restore -U chillberry -d prueba_restore --no-owner   < /opt/chillberry/backups/chillberry-AAAAMMDD-HHMM.dump

# Comparar y, si está bien, recién ahí decidir el reemplazo real
```

### Comprobar que sigue vivo

```bash
cat /opt/chillberry/backups/ULTIMO-EXITO   # fecha del último respaldo bueno
tail -20 /opt/chillberry/backups/backup.log
```

Si esa fecha tiene más de dos días, algo se rompió.

> Esto NO reemplaza un respaldo fuera del servidor. Protege contra corrupción,
> un borrado accidental o una migración que salió mal — pero si el VPS se
> pierde entero, se pierde con él. Hostinger hace un respaldo **semanal** de la
> máquina completa, que es la red de seguridad para ese caso.

## Ruteo de entregas (OSRM propio)

El seguimiento dibuja el camino real por las calles. El motor es **una
instancia propia**, no un servicio de terceros: sin API key, sin cuota y sin
límite de consultas.

> No lo apuntes al demo público `router.project-osrm.org`. Responde bien, así que
> es tentador, pero su política lo restringe a desarrollo: en producción
> terminan bloqueándote, y ese día tus clientes dejan de ver a su repartidor.

Los datos ya procesados viven en `/opt/osrm/data` (~613 MB) y se montan de sólo
lectura. **Para actualizar el mapa** (calles nuevas, cada varios meses):

```bash
cd /opt/osrm/data
curl -O https://download.geofabrik.de/south-america/paraguay-latest.osm.pbf
/opt/osrm/procesar.sh          # extract + partition + customize, ~2 min
docker service update --force chillberry_osrm
```

La ruta se **cachea por entrega** y se recalcula sólo por antigüedad (3 min) o
desvío real (300 m). Sin eso, con un ping de posición cada 20 segundos, una
entrega de media hora serían ~90 consultas — irrelevante con motor propio, pero
es lo que hace que el sistema también funcione contra un servicio con cuota si
algún día se cambia (`ROUTING_PROVIDER=ors`).

Archivos que definen todo esto, versionados en el repo:

| Archivo | Qué hace |
|---|---|
| `infra/stack.chillberry.yml` | los 4 servicios, redes y volúmenes |
| `infra/traefik-chillberry.yaml` | enrutado (copiado a `/etc/easypanel/traefik/config/chillberry.yaml`) |
| `/opt/chillberry/.env.prod` | secretos — **sólo en el servidor**, permisos 600 |

**El certificado se emite y se renueva solo** (`certResolver: letsencrypt` en
Traefik). No hay certbot ni renovación manual. El actual vence el 19/10/2026 y
se renueva sin intervención.

## Actualizar a una versión nueva

```bash
ssh root@72.60.51.162
cd /opt/chillberry
git pull origin main

# Reconstruir SÓLO lo que cambió. Subí el tag en cada release: Swarm no
# redespliega si el tag no cambia, y con :latest no sabés qué está corriendo.
docker build -f infra/Dockerfile.api -t chillberry-api:4 .
docker build -f infra/Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://chillberry.app/api \
  --build-arg NEXT_PUBLIC_SOCKET_URL=https://chillberry.app \
  --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAD6fygJTcsItdJGl \
  --build-arg NEXT_PUBLIC_ROOT_DOMAIN=chillberry.app \
  -t chillberry-web:2 .

# Actualizar los tags en infra/stack.chillberry.yml y redesplegar
set -a; . ./.env.prod; set +a
docker stack deploy -c infra/stack.chillberry.yml chillberry

# Si la versión trae migraciones:
docker exec $(docker ps -qf name=chillberry_api | head -1) \
  node_modules/.bin/prisma migrate deploy
```

> **Los 4 build args del front no son opcionales.** Next.js hornea las
> `NEXT_PUBLIC_*` en el bundle durante el build. Si olvidás la de Turnstile, el
> build sale verde y el sitio carga — pero login, registro y pedido público
> fallan todos, porque el front manda tokens de la clave de prueba y la API los
> valida contra la real.

> **Ojo con el build en este servidor**: compilar el front levanta la carga a ~2.5
> por unos minutos, compitiendo con el n8n que atiende WhatsApp de clientes. No
> lo rompe, pero puede hacer que un webhook responda lento. Si te preocupa,
> compilá en otra máquina y subí las imágenes a un registry.

## Trampas ya resueltas (no las repitas)

Tres cosas rompieron el despliegue y están arregladas en el repo. Las dejo
escritas porque las tres fallan de forma engañosa:

**1 · El healthcheck decía `localhost`.** La app escucha en `0.0.0.0` (sólo
IPv4) pero en Alpine `localhost` resuelve primero a `::1`. El healthcheck fallaba
siempre, Swarm daba el container por muerto y lo reiniciaba en bucle — con la API
perfectamente sana y logueando "Nest application successfully started". Ahora usa
`127.0.0.1`, en los dos Dockerfiles y en el compose.

**2 · `/app/uploads` no existía.** La app corre sin privilegios y `/app` es de
root, así que el `mkdir` de arranque moría con `EACCES`. Ahora el Dockerfile crea
el directorio con dueño, **y el stack monta un volumen ahí**: sin ese volumen las
fotos de los platos viven dentro del container y cada redeploy las borra.

**3 · El `.env` viajó de Windows con CRLF.** Cada valor arrastraba un `\r`
invisible: `MAIL_SANDBOX=false\r` no matchea el enum y la API no arranca. Si
volvés a subir un `.env` desde Windows, pasale `sed -i 's/\r$//'`.

## Verificación después de tocar algo

```bash
curl -s https://chillberry.app/api/health/ready     # {"status":"ok","db":"ok"}
curl -sI https://chillberry.app | head -1           # 200
curl -sI https://imaginelab.shop | head -1          # 200 — que no rompiste lo demás
docker stack services chillberry                    # los 4 en 1/1
```

## Aislamiento por sucursal — falta un paso TUYO

Cada empleado puede estar atado a una sucursal: el dueño ve todos los locales,
el resto (gerente, mozo, cajero, cocina) sólo el suyo. Está desplegado y probado,
pero **hoy nadie tiene sucursal asignada**, así que el sistema se comporta igual
que antes: todo el personal ve todos los locales.

Es a propósito — desplegar esto no podía cortarle el acceso a nadie de golpe.
Para activarlo, entrá a **Configuración → Equipo** y asignale su local a cada
uno. Los que están sin asignar aparecen marcados en amarillo con "Todas las
sucursales".

Ese aviso importa: en un mozo o un cajero significa que ve la caja y la
facturación de locales donde no trabaja. En el dueño es lo correcto y no lleva
etiqueta.

Cambiar a alguien de sucursal surte efecto cuando se le renueva el token, como
mucho 15 minutos después.

## Lo que queda pendiente

- **Rotar las credenciales** que pasaron por chat (API de Hostinger, root SSH,
  token de Emails, buzón, secret de Turnstile).
- **Sin monitoreo de errores**: no hay Sentry. Si algo revienta en producción,
  te enterás por el cliente.
- **Sin backup automático de la base.** El volumen `chillberry_postgres-data`
  vive en este servidor y nada lo respalda hoy. Es la deuda más cara de las tres:
  el día que se corrompa, no hay de dónde volver.
- **Pagos con tarjeta del comensal**: sólo existe el adaptador simulado. Efectivo
  es lo único real.
- **El cobro de las suscripciones NO está activo.** `BILLING_PROVIDER=mock` y
  `DLOCAL_API_BASE` apunta al sandbox, así que hoy ningún restaurante paga nada.
  La lógica está arreglada y probada contra el proveedor simulado (renovación
  mensual con factura por período, upgrades que pasan por el cobro), pero
  **nunca salió un request real contra dLocal, ni siquiera en su sandbox**.
  Para activarlo: `BILLING_PROVIDER=dlocal`, las dos claves, y recién cuando
  esté probado en sandbox, mover `DLOCAL_API_BASE` al host de producción.
- **El repartidor puede auto-calificarse 5/5.** El link de seguimiento usa la
  clave del pedido, que él conoce: marca entregado y califica antes que el
  cliente. Eso le sube el promedio con el que el sistema reparte pedidos y
  bloquea para siempre la calificación real. El arreglo de fondo es que el link
  lleve un token propio en vez de la clave del pedido.
