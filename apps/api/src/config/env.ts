import { z } from 'zod';

// Defaults de sandbox — nunca deben llegar a producción intactos. Ver el
// `.superRefine` más abajo, que bloquea el arranque si NODE_ENV=production
// y cualquiera de estos secretos todavía tiene su valor de default.
const INSECURE_DEFAULTS = {
  MOCK_PROVIDER_SECRET: 'dev-mock-provider-secret-change-me',
  DLOCAL_WEBHOOK_SECRET: 'dev-dlocal-webhook-secret-change-me',
  // Clave de prueba pública de Cloudflare — SIEMPRE aprueba, documentada en
  // https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
} as const;

const EnvSchemaBase = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  DEFAULT_COUNTRY_CODE: z.string().length(2).default('PY'),
  DEFAULT_TIMEZONE: z.string().default('America/Asuncion'),

  WEB_ORIGIN: z.string().default('http://localhost:3000'),

  // Fase 3 — proveedor de pagos sandbox (no llama a ningún servicio externo).
  MOCK_PROVIDER_SECRET: z.string().min(16).default('dev-mock-provider-secret-change-me'),

  // Fase 6 — SaaS billing. Mismo patrón sandbox que MOCK_PROVIDER_SECRET:
  // ningún llamado real a DLocal, solo firma HMAC simulada para poder probar
  // el flujo completo de suscripción + webhook + idempotencia.
  DLOCAL_WEBHOOK_SECRET: z.string().min(16).default('dev-dlocal-webhook-secret-change-me'),

  // Integración REAL de dLocal Go (cobro de suscripciones). Por defecto el
  // proveedor es 'mock' (no llama a nada externo). Poner BILLING_PROVIDER=dlocal
  // + las 2 claves activa el adapter real (`DlocalGoAdapter`). NO probado
  // end-to-end acá — requiere el sandbox de dLocal antes de ir a producción.
  BILLING_PROVIDER: z.enum(['mock', 'dlocal']).default('mock'),
  DLOCAL_API_KEY: z.string().min(1).optional(),
  DLOCAL_SECRET_KEY: z.string().min(1).optional(),
  // Host de la API de dLocal Go. Sandbox por defecto — cambiar al de producción
  // recién cuando el cobro esté probado.
  DLOCAL_API_BASE: z.string().url().default('https://api-sbx.dlocalgo.com'),


  // Envío de mail (códigos de alta y de recuperación de cuenta). Mismo criterio
  // que las notificaciones push: sin credenciales, el adapter loguea el mail en vez de
  // enviarlo, así el flujo completo se puede probar sin casilla configurada.
  // OJO: son las credenciales de la CASILLA (soporte@tudominio), no la API key
  // del proveedor de hosting — son cosas distintas.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  // Remitente visible. Si no se setea, se usa SMTP_USER: muchos servidores
  // rechazan enviar con un `from` distinto de la casilla autenticada.
  MAIL_FROM: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('Chillberry'),
  /**
   * Fuerza el modo sandbox aunque HAYA credenciales configuradas.
   *
   * Lo usa la suite e2e: sin esto, cada corrida manda mails REALES a direcciones
   * de prueba que no existen. Los rebotes son una de las señales más fuertes de
   * spam, así que correr los tests unas cuantas veces le arruina la reputación
   * al dominio antes de tener el primer cliente.
   */
  MAIL_SANDBOX: z.enum(['true', 'false']).default('false'),

  // Notificaciones push del navegador (Web Push + VAPID).
  //
  // Sirven para avisarle a alguien que no está mirando la
  // pantalla. Sin estas dos claves el sistema loguea en vez de enviar: el flujo
  // se prueba igual, pero nadie recibe nada.
  //
  // Se generan una sola vez y NO se rotan a la ligera: cambiarlas invalida
  // todas las suscripciones existentes y cada usuario tiene que volver a dar
  // permiso. Generar con:  node -e "console.log(require('web-push').generateVAPIDKeys())"
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),

  // Ruteo por calles para el seguimiento de entregas.
  //
  // `osrm` apunta a una instancia PROPIA: sin key, sin cuota, sin límite. Es la
  // opción recomendada — el extracto de Paraguay pesa ~150 MB y corre de sobra
  // en el mismo servidor.
  //
  // NO apuntar ROUTING_BASE_URL al demo público router.project-osrm.org: su
  // política lo limita a desarrollo y en producción terminan bloqueándote.
  //
  // `ors` (OpenRouteService) es la alternativa hospedada: 2.000 consultas
  // diarias gratis, requiere ORS_API_KEY.
  //
  // Sin configurar, el seguimiento muestra los dos puntos sin la línea.
  ROUTING_PROVIDER: z.enum(['osrm', 'ors']).default('osrm'),
  ROUTING_BASE_URL: z.string().url().optional(),
  ORS_API_KEY: z.string().min(1).optional(),

  // Bot-check (Cloudflare Turnstile) en register/login/pedido público por QR.
  // Default = clave de prueba de Cloudflare que siempre aprueba (ver
  // INSECURE_DEFAULTS) — funciona sin cuenta propia en dev, pero el
  // `superRefine` de abajo bloquea el arranque en producción hasta que se
  // reemplace por la clave real del sitio (dashboard de Cloudflare > Turnstile).
  TURNSTILE_SECRET_KEY: z.string().min(1).default('1x0000000000000000000000000000000AA'),
});

const EnvSchema = EnvSchemaBase.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  for (const [key, insecureValue] of Object.entries(INSECURE_DEFAULTS)) {
    if (env[key as keyof typeof INSECURE_DEFAULTS] === insecureValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} sigue en su valor de sandbox ("${insecureValue}") con NODE_ENV=production — generá un secreto real antes de desplegar.`,
      });
    }
  }
});

export type AppEnv = z.infer<typeof EnvSchemaBase>;

let cached: AppEnv | undefined;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format());
    process.exit(1);
  }
  cached = parsed.data;
  warnSandboxEnProduccion(cached);
  return cached;
}

/**
 * Integraciones que NO bloquean el arranque pero que en producción casi seguro
 * son un olvido: quedan en modo sandbox y fallan en silencio (los avisos se loguean
 * en vez de enviar; el cobro con tarjeta simula la aprobación). Sin este aviso
 * te enterás cuando un cliente reclama que nunca le llegó el mensaje.
 */
function warnSandboxEnProduccion(env: AppEnv): void {
  if (env.NODE_ENV !== 'production') return;

  const enSandbox: string[] = [];
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    enSandbox.push(
      'Notificaciones push (no se envía ningún aviso: pedido listo, delivery en camino, recordatorios y encuestas quedan sólo en el log)',
    );
  }
  if (env.BILLING_PROVIDER === 'mock') {
    enSandbox.push('Cobro de suscripciones (BILLING_PROVIDER=mock: no se cobra de verdad)');
  }
  if (!env.REDIS_URL) {
    enSandbox.push('Rate limiting en memoria (sin REDIS_URL el límite es POR INSTANCIA: con varias réplicas se afloja)');
  }
  const ruteoListo = env.ROUTING_PROVIDER === 'osrm' ? Boolean(env.ROUTING_BASE_URL) : Boolean(env.ORS_API_KEY);
  if (!ruteoListo) {
    enSandbox.push(
      'Ruteo de entregas (el seguimiento muestra los puntos pero no dibuja el camino ni calcula el tiempo real)',
    );
  }
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    enSandbox.push(
      'Envío de mail (los códigos de alta y de recuperación de cuenta se loguean en vez de enviarse: NADIE puede crear ni recuperar una cuenta)',
    );
  } else if (env.MAIL_SANDBOX === 'true') {
    // Peor que no tener credenciales: están puestas y alguien dejó prendido el
    // interruptor de los tests, así que parece configurado y no envía nada.
    enSandbox.push('MAIL_SANDBOX=true con SMTP configurado — el correo NO se envía. Es el flag de los tests.');
  }

  if (enSandbox.length > 0) {
    console.warn(
      `\n[ARRANQUE] NODE_ENV=production con integraciones en modo sandbox:\n` +
        enSandbox.map((s) => `  - ${s}`).join('\n') +
        `\nSi es a propósito, ignorá este aviso.\n`,
    );
  }
}
