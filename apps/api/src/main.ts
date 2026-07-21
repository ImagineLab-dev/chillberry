import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'node:fs';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { logger, pinoHttpOptions } from './common/logging/logger';
import { tenantContextMiddleware } from './common/tenant-context/tenant-context.middleware';
import { UPLOADS_DIR } from './modules/uploads/uploads.constants';

const BODY_LIMIT = '1mb';

async function bootstrap() {
  const env = loadEnv();
  const isProd = env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  // Directorio de uploads: creado defensivamente acá (no solo confiado al
  // .gitkeep del repo) para que arranque igual sin importar cómo se haya
  // desplegado el container (bind mount vacío, volumen nuevo, etc.).
  mkdirSync(UPLOADS_DIR, { recursive: true });
  app.useStaticAssets(UPLOADS_DIR, { prefix: '/uploads' });

  // Primerísimo middleware: abre el store de AsyncLocalStorage que
  // TenantPrismaService lee más abajo en la cadena (guards, controllers).
  app.use(tenantContextMiddleware);

  app.use(pinoHttp(pinoHttpOptions));

  const express = await import('express');
  app.use(
    express.json({
      limit: BODY_LIMIT,
      // Guarda el body crudo (bytes exactos) en `req.rawBody` — lo necesita
      // el controller de webhooks de pagos para validar la firma HMAC.
      // Validar contra el JSON re-serializado por Express rompería la firma
      // ante cualquier diferencia de espaciado/orden de claves.
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  // Detrás de nginx/proxy en producción — necesario para que req.ip sea el real.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  const allowedOrigins = env.WEB_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS: origin no permitido'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      /**
       * class-validator devuelve sus mensajes por defecto EN INGLÉS y como un
       * array de strings. El front hace `setError(err.message)` sobre un
       * `useState<string>`, así que React terminaba pintando el array pegoteado
       * en el Alert rojo: un repartidor con el código incompleto leía
       * "confirmationCode must be longer than or equal to 4 characters".
       *
       * Acá se colapsa a UNA frase en castellano. No se listan los nombres
       * técnicos de los campos (`confirmationCode`) porque no significan nada
       * para un mozo o un cajero: el detalle queda en el `errors` para debug.
       */
      exceptionFactory: (errors) => {
        const detalle = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).filter(Boolean);
        return new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Revisá los datos: hay algo incompleto o mal cargado.',
          details: detalle,
        });
      },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'Chillberry API listening');
}

bootstrap().catch((err) => {
  console.error('[MAIN] Bootstrap failed:', err instanceof Error ? (err.stack ?? err.message) : err);
  Logger.error('Bootstrap failed', err instanceof Error ? err.stack : err);
  process.exit(1);
});
