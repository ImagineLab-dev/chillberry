import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { loadEnv } from '../../config/env';

/**
 * Rate limiting global: 60 req/60s y 300 req/5min por IP como default.
 * Endpoints sensibles (login, register) tienen @Throttle() propio más estricto
 * (5/min) — la principal defensa contra fuerza bruta de credenciales.
 *
 * Storage: **Redis si `REDIS_URL` está seteado, in-memory si no**. Con in-memory
 * el contador vive POR INSTANCIA — con varias réplicas detrás de un balanceador
 * el límite se afloja (5/min pasa a ser 5/min por réplica). Con Redis el
 * contador es compartido y el límite es real sin importar cuántas réplicas haya.
 * En dev/E2E (sin REDIS_URL) queda in-memory.
 */
const env = loadEnv();

const options: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'short', ttl: 60_000, limit: 60 },
    { name: 'medium', ttl: 5 * 60_000, limit: 300 },
  ],
  // Apagable por entorno: la suite E2E se loguea decenas de veces por minuto
  // contra la MISMA API y se auto-limitaría (login = 5/min). En prod el flag no
  // se setea, así que el rate-limit queda activo.
  skipIf: () => process.env.DISABLE_THROTTLE === 'true',
  ...(env.REDIS_URL
    ? { storage: new ThrottlerStorageRedisService(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })) }
    : {}),
};

@Module({
  imports: [ThrottlerModule.forRoot(options)],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottlerModule {}
