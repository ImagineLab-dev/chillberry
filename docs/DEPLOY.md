# Puesta en producción

Checklist real, en orden. Lo marcado **BLOQUEANTE** impide desplegar de forma
segura; el resto degrada funcionalidad sin romper nada.

Dos cosas están diseñadas para no dejarte olvidar lo importante:

- La **API no arranca** con `NODE_ENV=production` si algún secreto sigue en su
  valor de sandbox (`apps/api/src/config/env.ts` → `INSECURE_DEFAULTS`).
- El **build del front falla** si `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no está
  configurada (`apps/web/src/components/turnstile.tsx`).

Si algo de esto te frena el deploy, es a propósito.

> ## ⚠️ Leé esto primero
>
> El servidor de producción (`72.60.51.162`) tiene **Easypanel** ocupando los
> puertos 80 y 443, así que **las secciones 2.c y 2.d de este documento no
> aplican** — el certbot fallaría por puerto ocupado y el nginx del compose no
> podría levantar.
>
> **El procedimiento vigente está en [DEPLOY-EASYPANEL.md](DEPLOY-EASYPANEL.md).**
>
> Este documento sigue siendo válido para todo lo demás (secretos, DNS,
> integraciones, deuda conocida) y como referencia si algún día se sale de
> Easypanel a un servidor pelado.

---

## 1. Secretos que hay que generar — BLOQUEANTE

| Variable | Dónde | Cómo se obtiene |
|---|---|---|
| `JWT_ACCESS_SECRET` | API | 32+ caracteres aleatorios (`openssl rand -base64 48`) |
| `JWT_REFRESH_SECRET` | API | ídem, **distinto** del anterior |
| `MOCK_PROVIDER_SECRET` | API | aleatorio; si sigue en el default, la API no arranca |
| `DLOCAL_WEBHOOK_SECRET` | API | el que te da dLocal; si sigue en el default, la API no arranca |
| `TURNSTILE_SECRET_KEY` | API | Cloudflare → Turnstile → tu sitio (clave **secreta**) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Web | Cloudflare → Turnstile → tu sitio (clave **de sitio**) |

> **Por qué Turnstile es bloqueante:** sin esas dos claves el sistema usa la
> clave de prueba pública de Cloudflare, que **aprueba a cualquiera**, y el front
> manda un token de bypass. El resultado es peor que no tener protección, porque
> aparenta tenerla: cualquiera puede automatizar pedidos falsos contra tu carta
> pública y hacer fuerza bruta contra el login.

## 2. Infraestructura — BLOQUEANTE

- `DATABASE_URL` apuntando al Postgres de producción.
- `REDIS_URL` configurada. **Sin Redis el rate limiting es por instancia**: con
  varias réplicas detrás de un balanceador, un límite de 5/min pasa a ser 5/min
  *por réplica*. Con una sola instancia funciona igual, pero no escala.
- `WEB_ORIGIN` con el dominio real (lista separada por comas si hay varios). El
  CORS rechaza cualquier origen que no esté acá.
- `API_BASE_URL` y `NEXT_PUBLIC_API_BASE_URL` con el dominio real y HTTPS.
- Migraciones aplicadas: `pnpm --filter @chillberry/api prisma:deploy`.
  **Nunca** `prisma migrate dev` en producción.

## 2.b DNS del dominio — BLOQUEANTE para el correo

Sin estos registros, los códigos de alta y de recuperación **caen en spam** y el
cliente cree que el sistema está roto. Peor: si mandás mail sin autenticar desde
un dominio nuevo, los proveedores lo marcan y después cuesta recuperar la
reputación. Configuralos **antes** del primer envío.

| Tipo | Nombre | Valor |
|---|---|---|
| TXT | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:soporte@chillberry.app` |
| TXT | (DKIM) | **lo genera Hostinger** — hPanel → Emails → tu dominio → DKIM |
| MX | `@` | los que Hostinger crea al dar de alta la casilla |

- **SPF** declara qué servidores pueden enviar en nombre del dominio.
- **DKIM** firma cada mensaje; el valor es único por dominio, no se puede inventar
  ni copiar de otro lado.
- **DMARC** arranca en `p=none` a propósito: primero observás los reportes, y
  recién cuando confirmás que todo lo legítimo pasa, endurecés a `quarantine` y
  después a `reject`. Poner `reject` de entrada corta tu propio correo.

Para la app, además:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `@` | `72.60.51.162` — **ya aplicado y propagando** |
| A | `*` | IP del servidor — opcional, ver abajo |

> Estado real de la zona al 21/07/2026: el `A` ya apunta al VPS, y SPF, DKIM
> (3 CNAME `hostingermail-*`) y DMARC ya estaban configurados. **Este bloque ya
> está hecho.**

El registro **A del `@` es todo lo que necesitás para salir**. El link que el
sistema le da a cada restaurante para compartir es por ruta
(`chillberry.app/r/mi-restaurante`, ver `branch-public-config.tsx`), así que el
dominio raíz cubre el 100% del producto.

El comodín `*` es sólo para el día que le habilites a un cliente su propio
subdominio (`publicSubdomain`, un campo **opcional** del modelo). Podés agregarlo
después sin tocar nada más — pero ojo, ahí también cambia el certificado
(ver 2.c).

## 2.c Certificado TLS — *(no aplica con Easypanel, ver aviso arriba)*

Con un dominio `.app` no hay opción: está en la lista **HSTS preload** de los
navegadores, así que Chrome, Firefox y Safari **se niegan a abrir HTTP** sin
posibilidad de continuar. Sin certificado el sitio no carga — no es que sea
inseguro, es que no funciona.

**Para salir alcanza con un certificado común**, no hace falta wildcard. El link
que el sistema le da a cada restaurante es por ruta
(`chillberry.app/r/mi-restaurante`), así que el dominio raíz cubre todo.

**Hay un huevo-y-gallina y por eso la primera emisión es distinta de las
renovaciones:** nginx no arranca si el certificado no existe, pero
`certbot --webroot` necesita que nginx sirva el desafío por el puerto 80. No se
puede empezar por ninguno de los dos. La salida es emitir la primera vez con
`--standalone`, que levanta su propio servidor temporal en el 80 (por eso va
**antes** del primer `up`, con el puerto todavía libre):

```bash
mkdir -p /var/www/certbot

# PRIMERA emisión — el puerto 80 tiene que estar libre (stack abajo).
certbot certonly --standalone \
  -d chillberry.app \
  --agree-tos -m soporte@chillberry.app
```

Ya con el certificado en disco, nginx arranca. Pero **falta un paso**: certbot
guardó que este certificado se renueva con `--standalone`, y de ahora en más el
puerto 80 lo va a tener nginx, así que la renovación fallaría dentro de 60 días.
Hay que dejarlo fijado en modo webroot **una sola vez**:

```bash
# En /etc/letsencrypt/renewal/chillberry.app.conf, dentro de [renewalparams]:
#   authenticator = webroot
#   webroot_path = /var/www/certbot
sed -i 's/^authenticator = standalone/authenticator = webroot\nwebroot_path = \/var\/www\/certbot/' \
  /etc/letsencrypt/renewal/chillberry.app.conf

# Y lo comprobás sin gastar una emisión real (con el stack ya levantado):
certbot renew --dry-run
```

Si ese `--dry-run` pasa, la renovación queda **automática** para siempre:
certbot instala su propio timer y valida contra
`/.well-known/acme-challenge/`, que nginx ya sirve por el 80.

> No te saltees el `--dry-run`. Es la única forma de enterarte hoy —y no en 60
> días, con el sitio caído— de si la renovación quedó bien configurada.

<details>
<summary>Cuándo SÍ vas a necesitar wildcard</summary>

El día que le habilites a un cliente su propio subdominio (`publicSubdomain`,
ej. `hamburgueseria.chillberry.app`), el certificado del dominio raíz deja de
cubrirlo y el navegador muestra error de certificado. Ahí hace falta:

```bash
certbot certonly --manual --preferred-challenges dns \
  -d chillberry.app -d '*.chillberry.app' \
  --agree-tos -m soporte@chillberry.app
```

**Ojo con esto**: los wildcards sólo se validan por DNS-01, y con el DNS en
Hostinger (sin plugin de certbot) la renovación es MANUAL cada 90 días. El día
que te olvides, el sitio deja de cargar entero — por el HSTS de `.app` ni
siquiera degrada a HTTP. Si llegás a ese punto, conviene mover el DNS a
Cloudflare y usar `--dns-cloudflare` para que renueve solo.

</details>

## 2.d Levantar el stack — *(no aplica con Easypanel, ver aviso arriba)*

El archivo de entorno tiene que llamarse **`infra/.env.production`**, ese nombre
literal: es el que el compose declara en `env_file:`. Copiá la plantilla:

```bash
scp infra/.env.production.template root@TU_SERVIDOR:/opt/chillberry/infra/.env.production
# …y completás los valores en el servidor
```

El `--env-file` va **siempre explícito** en los tres comandos. `env_file:` inyecta
las variables *dentro* de los containers, pero NO resuelve los `${...}` del propio
YAML — que es de donde salen los build args del front. Sin él, el build corta con
`NEXT_PUBLIC_API_BASE_URL: debe definirse`.

```bash
cd /opt/chillberry
CO="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production"

# 1. Construir las imágenes.
$CO build

# 2. Migrar la base ANTES de levantar la app. El compose no migra solo: el
#    container de la API arranca `node dist/main.js` y nada más. Esto levanta
#    Postgres, espera a que esté healthy, corre las migraciones y se va.
$CO run --rm api pnpm exec prisma migrate deploy

# 3. Recién ahora, levantar todo.
$CO up -d

# 4. Confirmar que los cuatro quedaron arriba y healthy.
$CO ps
```

> **No probado end-to-end**: la secuencia sale de leer el compose y el
> Dockerfile, pero no tengo servidor donde correrla. Lo más frágil es el paso 2
> (que el CLI de `prisma` haya quedado dentro de la imagen). Si ahí falla,
> el fallback es `$CO run --rm api npx prisma migrate deploy`.

## 3. Integraciones — funcionan sin esto, pero en modo simulado

Al arrancar con `NODE_ENV=production`, la API **avisa por consola** cuáles
quedaron en sandbox. No bloquea: puede ser a propósito.

- **WhatsApp** (`WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`): sin esto no
  sale **ningún** mensaje — ni la confirmación del pedido, ni el aviso al
  repartidor, ni la encuesta post-visita. Se loguean en vez de enviarse.
  Requiere además tener las plantillas aprobadas en Meta.
- **Cobro de suscripciones** (`BILLING_PROVIDER=dlocal` + `DLOCAL_API_KEY` +
  `DLOCAL_SECRET_KEY`): con `mock` no se cobra de verdad. Cambiar
  `DLOCAL_API_BASE` al host de producción **recién** después de probar en el
  sandbox de dLocal.

## 4. Lo que NO está implementado

- **Pagos del comensal con tarjeta/QR en la caja.** El único adaptador que existe
  es `mock-payment.adapter.ts`: aprueba siempre y no llama a ningún proveedor.
  Hoy sólo el efectivo es real. (No confundir con el adaptador de dLocal, que es
  para el cobro de las **suscripciones del SaaS**, no para los pedidos.)
- **Facturación fiscal.** La numeración es secuencial propia
  (`default-fiscal.adapter`), sin integración con la SET.
- **Monitoreo de errores.** No hay Sentry ni equivalente: si algo revienta en
  producción, te enterás por el cliente.

## 5. Verificación antes de publicar

```bash
pnpm typecheck && pnpm lint && pnpm build     # los tres tienen que pasar

# Suite e2e (101 tests) contra una API levantada. Los DOS flags son obligatorios
# y van declarados en turbo.json > globalEnv — si no, turbo los filtra y nunca
# llegan al proceso de la API:
#   DISABLE_THROTTLE: la suite se loguea decenas de veces por minuto y el
#     rate-limit la cortaría entera con 429.
#   MAIL_SANDBOX: sin él la suite manda mails REALES a direcciones de prueba que
#     no existen, y los rebotes queman la reputación del dominio.
DISABLE_THROTTLE=true MAIL_SANDBOX=true pnpm dev
pnpm --filter @chillberry/api test:e2e
```

## 6. Después de desplegar

- [ ] Entrar al admin y confirmar que el gráfico de "Ingresos — últimos 7 días"
      dibuja barras.
- [ ] Hacer un pedido de punta a punta desde la carta pública y cobrarlo.
- [ ] Cerrar una caja y revisar que el arqueo cuadre.
- [ ] **Rotar los `qrToken`** de las mesas si el sistema estuvo expuesto con la
      fuga de `/waiter/tables` (`POST /tables/:id/rotate-qr`, mesa por mesa) y
      reimprimir los QR físicos.

## Deuda conocida

Ninguna de estas rompe hoy, pero conviene saberlas:

- **Las propinas en efectivo suman al efectivo esperado del arqueo.** Si el mozo
  se lleva sus propinas del cajón sin registrar un `PAY_OUT`, el cierre marca un
  faltante exactamente igual a las propinas — y parece robo.
- **El stock puede quedar negativo**: no hay validación de disponibilidad al
  tomar un pedido, sólo el flag manual `soldOut`. La receta/inventario es
  contable, no operativa.
- **`tenant-prisma`**: `findUnique` dentro de una transacción interactiva se
  ejecuta FUERA de esa transacción (la extensión lo reenvía al cliente base).
  Hoy no está disparado, pero rompería una garantía sin dar ningún error.
