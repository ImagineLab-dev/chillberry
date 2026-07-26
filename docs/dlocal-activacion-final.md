# dLocal — los dos últimos pasos (operador)

dLocal ya está **activo en producción** (`BILLING_PROVIDER=dlocal`, base
`https://api.dlocalgo.com`, claves en `/opt/chillberry/.env.prod`). Faltan dos
cosas que **sólo las puede hacer un humano** — no hay API para automatizarlas:

1. **Rotar las claves** (las que pasaron por chat quedaron expuestas).
2. **Una prueba de cobro real** con tarjeta, para confirmar el flujo punta a punta.

Todo lo demás ya está probado: creación del plan por API, prellenado del país en
el checkout, firma del webhook (fix C1 verificado contra firma real), y la lógica
de activación de la suscripción (e2e con el proveedor simulado).

---

## Paso 1 — Rotar las claves de dLocal

**Por qué:** la API Key y la Secret Key viajaron por un chat. Mientras no se
roten, siguen siendo válidas y podría usarlas cualquiera que las haya visto.
Rotarlas invalida las viejas.

### 1.a — En el panel de dLocal (esto lo hacés vos)

1. Entrá a tu panel de dLocal Go → sección de **API Keys / Credenciales**.
2. **Generá un par nuevo** (API Key + Secret Key). Si el panel permite
   **revocar** el par viejo, revocalo.
3. Copiá las dos claves nuevas.

### 1.b — Cargar las nuevas en el servidor

`.env.prod` vive **sólo en el servidor** (permisos 600, nunca en el repo). Hay
que editarlo y redeployar para que la API lo tome:

```bash
ssh -i ~/.ssh/chillberry_vps root@72.60.51.162
cd /opt/chillberry

# Editá el archivo y reemplazá SOLO estas dos líneas por las claves nuevas:
#   DLOCAL_API_KEY=<nueva-api-key>
#   DLOCAL_SECRET_KEY=<nueva-secret-key>
nano .env.prod          # o el editor que prefieras

# Si copiaste/pegaste desde Windows, sacá posibles \r invisibles:
sed -i 's/\r$//' .env.prod

# Re-inyectar el env y redeployar (Swarm reinicia la api con las claves nuevas):
set -a; . ./.env.prod; set +a
docker stack deploy -c infra/stack.chillberry.yml chillberry

# Verificar que la api quedó sana con la config correcta:
sleep 8
docker exec $(docker ps -qf name=chillberry_api | head -1) \
  printenv BILLING_PROVIDER DLOCAL_API_BASE     # -> dlocal / https://api.dlocalgo.com
curl -s https://chillberry.app/api/health/ready # -> {"status":"ok","db":"ok"}
```

> Si preferís, pasame las dos claves nuevas y hago esto por vos (editar
> `.env.prod` + redeploy + verificar). No quedan en el repo, sólo en el server.

### 1.c — Confirmar que las viejas ya no sirven

Opcional, pero cierra el tema. Con las claves VIEJAS, esto debería dar 401/403:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.dlocalgo.com/v1/subscription/plan/22742 \
  -H "Authorization: Bearer <API_KEY_VIEJA>:<SECRET_VIEJA>"
```

---

## Paso 2 — La prueba de cobro real

**Por qué:** dLocal producción no tiene modo de prueba. Un cobro es plata de
verdad. Es la única forma de confirmar que **pago → webhook → activación de la
suscripción** funciona de punta a punta contra el proveedor real.

### Cómo hacerla

1. Entrá a `https://chillberry.app` con tu cuenta **dueño (owner)**.
2. **Configuración → Facturación** → tocá **activar/cambiar** a un plan.
   Usá el plan **más barato** para arriesgar poco.
3. Te redirige al **checkout real de dLocal** (`checkout.dlocalgo.com`). El país
   ya viene **preseleccionado** (por el prellenado que agregamos).
4. Pagá con tu tarjeta.
5. Apenas pagues, dLocal cobra y dispara el webhook a nuestro `/webhooks/dlocal`.
   La suscripción debería pasar a **activa**.

### Mirar el webhook en vivo (mientras se hace el pago)

```bash
ssh -i ~/.ssh/chillberry_vps root@72.60.51.162
docker service logs -f chillberry_api 2>&1 \
  | grep -iE "webhook|dlocal|suscrip|payment|SUBSCRIPTION"
```

- **Éxito:** ves llegar el `POST /webhooks/dlocal`, la firma válida, el estado
  `PAID` y la suscripción aplicándose.
- **Si algo falla:** el error queda en ese log. Si el pago quedó cobrado pero la
  suscripción no se activó, dLocal **reintenta** el webhook (cada ~10 min), así
  que suele resolverse solo; si no, con el log en mano se corrige el punto exacto.

> Decime cuándo la vas a hacer y miro los logs con vos en tiempo real.

### Después de probar

- Podés **cancelar** la suscripción de prueba desde Facturación (o pedir el
  reembolso del cobro en dLocal si querés recuperar ese monto).
- El plan de prueba **22742** ("Chillberry VERIF (borrar)") sigue activo en el
  panel — dLocal no deja borrarlo por API. Es inofensivo (una plantilla que nadie
  paga salvo que entre a su link), pero si te molesta, desactivalo desde el panel.

---

**Con estos dos pasos, dLocal queda 100% cerrado:** claves seguras y el cobro
real confirmado.
