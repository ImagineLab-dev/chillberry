import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { URLSearchParams } from 'node:url';
import { loadEnv } from '../../config/env';

interface SiteverifyResponse {
  success: boolean;
  ['error-codes']?: string[];
}

/**
 * Verificación de bot-check (Cloudflare Turnstile) para endpoints públicos
 * de alto riesgo (registro, login, pedido por QR sin auth). Mismo patrón
 * sandbox que `MOCK_PROVIDER_SECRET`/`DLOCAL_WEBHOOK_SECRET`: el default de
 * `TURNSTILE_SECRET_KEY` es la clave de prueba pública de Cloudflare que
 * SIEMPRE aprueba — sirve para desarrollar sin cuenta propia, pero el
 * `superRefine` de `env.ts` bloquea el arranque en producción hasta que se
 * reemplace por una clave real.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(token: string | undefined, remoteIp?: string | null): Promise<void> {
    if (!token) {
      throw new BadRequestException('Verificación de seguridad requerida');
    }

    const env = loadEnv();
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let data: SiteverifyResponse;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      data = (await res.json()) as SiteverifyResponse;
    } catch (err) {
      this.logger.error(`No se pudo contactar a Cloudflare Turnstile: ${(err as Error).message}`);
      throw new BadRequestException('No se pudo validar la verificación de seguridad — intentá de nuevo');
    }

    if (!data.success) {
      this.logger.warn(`Turnstile rechazado: ${JSON.stringify(data['error-codes'])}`);
      throw new BadRequestException('Verificación de seguridad fallida — recargá la página e intentá de nuevo');
    }
  }
}
