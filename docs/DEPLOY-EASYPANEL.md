# Puesta en producción con Easypanel

El VPS (`72.60.51.162`) viene con **Easypanel** ya instalado y ocupando los
puertos 80 y 443. Su panel está en `http://72.60.51.162:3000`.

Desplegar a través de Easypanel en vez de con el nginx propio tiene una ventaja
concreta: **el certificado TLS lo emite y lo renueva solo**. Todo el
procedimiento de certbot de [DEPLOY.md](DEPLOY.md) §2.c —incluida la trampa de
la renovación— deja de aplicar.

> **Estado de este documento: NO verificado contra tu panel.** Los pasos salen de
> cómo funciona Easypanel en general y del contenido real del repo, pero no tengo
> acceso al panel. Los nombres exactos de los campos pueden variar según la
> versión. Donde el nombre importa, aclaro qué hace el campo para que lo
> identifiques aunque se llame distinto.

Lo que sigue **reemplaza** las secciones 2.c y 2.d de DEPLOY.md. Todo lo demás
—los secretos de §1, el DNS de §2.b, las integraciones de §3— aplica igual.

---

## 0. Prerrequisito: el código tiene que estar en un repo Git

Hoy el proyecto **no es un repositorio git**. Easypanel construye las
aplicaciones clonando desde GitHub/GitLab, así que sin esto no hay por dónde
empezar.

```bash
git init
git add .
git commit -m "Primera versión de Chillberry"
# …crear un repo PRIVADO en GitHub y:
git remote add origin git@github.com:TU_USUARIO/chillberry.git
git push -u origin main
```

**Que sea privado no es un detalle.** Aunque `.gitignore` excluye los `.env`, un
repo público expone la estructura completa del sistema.

Antes del primer `git add .`, verificá que ningún secreto se cuele:

```bash
git status --short | grep -E "\.env$|\.env\." || echo "OK: ningún .env va al commit"
```

---

## 1. Crear el proyecto y las bases

En Easypanel, un **proyecto** agrupa servicios que se ven entre sí por red
interna. Creá uno llamado `chillberry` y dentro, estos cuatro servicios.

### 1.a Postgres

Servicio de tipo **Postgres** (no una app). Easypanel lo provisiona con volumen
persistente y te muestra la cadena de conexión interna, del estilo:

```
postgresql://postgres:CLAVE@chillberry_postgres:5432/postgres
```

**Copiala tal cual**: ese hostname interno es el que va en `DATABASE_URL`, con
`?schema=public` al final. No uses `localhost` — cada servicio es un container
distinto.

### 1.b Redis

Servicio de tipo **Redis**. Misma idea; la URL queda `redis://chillberry_redis:6379`.

Sin Redis el rate limiting es por instancia. Con una sola réplica da igual, pero
es gratis dejarlo bien de entrada.

### 1.c App `api`

Servicio de tipo **App**, con estos ajustes:

| Campo | Valor |
|---|---|
| Origen | tu repo de GitHub, rama `main` |
| Método de build | Dockerfile |
| Ruta del Dockerfile | `infra/Dockerfile.api` |
| Contexto de build | `.` (la raíz del repo — el Dockerfile copia del monorepo entero) |
| Puerto | `3001` |

**Variables de entorno**: pegá el contenido de
[.env.production.template](../infra/.env.production.template) completado, salvo
las `POSTGRES_*` (esas ya las maneja el servicio de Postgres) y las
`NEXT_PUBLIC_*` (esas son del front, y van como *build args*, ver 1.d).

**Dominios** — dos entradas, las dos apuntando a este servicio:

| Host | Ruta | Puerto |
|---|---|---|
| `chillberry.app` | `/api` | 3001 |
| `chillberry.app` | `/socket.io` | 3001 |

> **Crítico: NO actives el "strip path" / "quitar prefijo"** si el panel lo
> ofrece. La API de NestJS ya sirve todo bajo el prefijo `/api` por su cuenta
> (`setGlobalPrefix`). Si Traefik le saca el `/api` antes de pasarle la request,
> la app responde 404 en absolutamente todo y parece que el deploy falló.

La entrada de `/socket.io` es la que mantiene vivo el tiempo real de cocina y
mesas. Traefik maneja WebSockets sin configuración extra.

### 1.d App `web`

| Campo | Valor |
|---|---|
| Origen | el mismo repo, rama `main` |
| Ruta del Dockerfile | `infra/Dockerfile.web` |
| Contexto de build | `.` |
| Puerto | `3000` |

**Build args** (no variables de entorno — es distinto, y acá se nota):

```
NEXT_PUBLIC_API_BASE_URL=https://chillberry.app/api
NEXT_PUBLIC_SOCKET_URL=https://chillberry.app
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<tu site key de Cloudflare>
NEXT_PUBLIC_ROOT_DOMAIN=chillberry.app
```

**Por qué build args y no env vars:** Next.js incrusta las `NEXT_PUBLIC_*` dentro
del JavaScript que se manda al navegador, y eso pasa **en el momento del build**.
Si las cargás como variables de entorno del container, el build ya terminó sin
ellas y el navegador recibe `undefined` — el front carga pero no le pega a la
API, sin ningún error en los logs del servidor.

**Dominio**: `chillberry.app`, ruta `/`, puerto 3000. Es el catch-all; las rutas
`/api` y `/socket.io` ganan por ser más específicas.

---

## 2. Migrar la base — antes del primer uso

El container de la API arranca `node dist/main.js` y nada más: **no migra por su
cuenta**. Desde la consola del servicio `api` en Easypanel:

```bash
pnpm exec prisma migrate deploy
```

Si el CLI de `prisma` no quedó en la imagen, el fallback es
`npx prisma migrate deploy`.

Sin este paso la API arranca pero falla en cada request contra la base, con
errores de tabla inexistente.

---

## 3. TLS

No hay nada que hacer: al asignar el dominio, Easypanel pide el certificado a
Let's Encrypt y lo renueva solo. Sólo asegurate de que el registro `A` de
`chillberry.app` ya apunte al servidor **antes** de asignar el dominio, o la
emisión falla.

Ese registro ya está puesto y propagado:

```
chillberry.app.  300  IN  A  72.60.51.162
```

---

## 4. Verificación

```bash
# El front carga y redirige a HTTPS
curl -sI http://chillberry.app | head -1          # 301/308
curl -sI https://chillberry.app | head -1         # 200

# La API responde bajo /api (si esto da 404, revisá el "strip path" de 1.c)
curl -s https://chillberry.app/api/health/ready

# El certificado es real, no autofirmado
curl -sI https://chillberry.app >/dev/null && echo "TLS OK"
```

Y después, en el navegador: crear una cuenta de punta a punta. Ese flujo toca
todo lo frágil junto —base, correo (el código de verificación), y Turnstile—, así
que si funciona, el sistema está realmente arriba.

---

## Qué queda sin usar de la configuración anterior

- **`infra/nginx.conf`** — Traefik hace de reverse proxy. El archivo queda en el
  repo por si algún día salís de Easypanel; no se despliega.
- **`infra/docker-compose.prod.yml`** — Easypanel administra los servicios por su
  cuenta. Sirve como referencia de qué necesita cada uno.
- **[DEPLOY.md](DEPLOY.md) §2.c y §2.d** — todo el procedimiento de certbot.

Ojo con una diferencia real: el nginx propio tenía
`proxy_read_timeout 3600s` en `/socket.io` para que las pantallas de cocina y de
mozos no se desconecten. Traefik no corta conexiones WebSocket inactivas por
defecto, así que en principio no hace falta — pero si ves que las pantallas se
caen solas al rato, empezá a investigar por ahí.
