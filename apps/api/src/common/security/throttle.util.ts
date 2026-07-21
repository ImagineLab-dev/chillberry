import { seconds } from '@nestjs/throttler';

/**
 * Override de rate-limit por endpoint, MÁS ESTRICTO que el global.
 *
 * OJO (bug histórico): `@Throttle({ default: {...} })` NO funciona en este
 * proyecto. El `ThrottlerGuard` recorre los throttlers CONFIGURADOS por nombre
 * (`short`, `medium` — ver `AppThrottlerModule`) y sólo lee el override de la
 * ruta bajo esos nombres. Un override con la clave `default` (que no existe
 * como throttler configurado) nunca se lee y el límite estricto queda inerte:
 * el endpoint cae al global de 60/min. Por eso las claves acá son `short` y
 * `medium`, y este helper centraliza el patrón para no repetir el error.
 *
 * @param perMinute tope por ventana de 60s. La ventana de 5min se escala x5
 *   para que no quede más estricta que la intención por minuto.
 */
export function strictThrottle(perMinute: number): Record<string, { ttl: number; limit: number }> {
  return {
    short: { ttl: seconds(60), limit: perMinute },
    medium: { ttl: seconds(300), limit: perMinute * 5 },
  };
}
