import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from '../../config/env';

const env = loadEnv();

/**
 * Logger global con Pino. JSON estructurado para que Loki/CloudWatch lo
 * indexen. Campos sensibles redactados automáticamente — defensa contra
 * leaks accidentales de tokens/passwords/tarjetas en logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
      'authorization',
      'cookie',
      'cardNumber',
      'cvv',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.cardNumber',
      '*.cvv',
      // Códigos que son credenciales, no datos:
      //  - `confirmationCode`: el que el cliente le dicta al repartidor para
      //    cerrar la entrega. Se saca de todas las respuestas que lee un
      //    repartidor; si se colara en un log, ese trabajo no serviría de nada.
      //  - `code` / `codigo`: el de 6 dígitos del alta y de la recuperación de
      //    cuenta. Con ese código se crea una cuenta o se cambia una contraseña.
      'confirmationCode',
      '*.confirmationCode',
      'code',
      '*.code',
      'codigo',
      '*.codigo',
      // Secretos de configuración, por si alguna vez se loguea `process.env`
      // entero al depurar un arranque.
      'SMTP_PASSWORD',
      '*.SMTP_PASSWORD',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'DLOCAL_SECRET_KEY',
      'TURNSTILE_SECRET_KEY',
    ],
    censor: '[REDACTED]',
  },
  base: {
    service: 'chillberry-api',
    env: env.NODE_ENV,
  },
});

/** Config para `pino-http` — request id, duración, skip de /health. */
export const pinoHttpOptions = {
  logger,
  genReqId: (req: IncomingMessage) => {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const incoming = headers['x-request-id'];
    if (typeof incoming === 'string' && incoming.length > 0 && incoming.length < 200) {
      return incoming;
    }
    return randomUUID();
  },
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err: Error | undefined) => {
    if (err || res.statusCode >= 500) return 'error' as const;
    if (res.statusCode >= 400) return 'warn' as const;
    return 'info' as const;
  },
  customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) =>
    `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
  customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) =>
    `${req.method} ${req.url} ${res.statusCode} ${err.message}`,
  autoLogging: {
    ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/health'),
  },
  serializers: {
    req: (req: IncomingMessage & { id?: string; ip?: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: (req.headers as Record<string, string>)?.['user-agent'],
    }),
    res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
  },
};
