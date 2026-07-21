import { Injectable } from '@nestjs/common';
import webpush from 'web-push';
import { loadEnv } from '../../../config/env';
import { logger } from '../../../common/logging/logger';

export interface DestinoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface AvisoPush {
  titulo: string;
  cuerpo: string;
  /** Adónde lleva al tocar el aviso. Relativa al sitio. */
  url?: string;
  /** Agrupa avisos del mismo tema: uno nuevo reemplaza al anterior en vez de
   *  apilarse. Sin esto, cinco cambios de estado son cinco notificaciones. */
  etiqueta?: string;
}

/** Resultado de un envío, para que el llamador sepa si conviene descartar el destino. */
export type ResultadoPush = 'ok' | 'muerta' | 'error';

/**
 * Notificaciones push del navegador (Web Push + VAPID).
 *
 * Reemplazan a WhatsApp para llegarle a quien no está mirando la pantalla, sin
 * cuentas de terceros, sin plantillas que aprobar y sin riesgo de que bloqueen
 * una línea.
 *
 * Sin `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` queda en modo sandbox: loguea en
 * vez de enviar, igual que hacían el correo y el ruteo. Así el flujo completo
 * se prueba sin configurar nada.
 *
 * NUNCA lanza. Un aviso que no sale no puede tumbar el cobro de un pedido ni la
 * entrega de un delivery.
 */
@Injectable()
export class PushAdapter {
  private configurado = false;

  get habilitado(): boolean {
    const env = loadEnv();
    return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  }

  private configurar(): void {
    if (this.configurado) return;
    const env = loadEnv();
    webpush.setVapidDetails(
      // `mailto:` es obligatorio en el estándar: es a quién contacta el servicio
      // de push (Google, Apple, Mozilla) si algo anda mal con nuestros envíos.
      `mailto:${env.MAIL_FROM ?? 'soporte@chillberry.app'}`,
      env.VAPID_PUBLIC_KEY!,
      env.VAPID_PRIVATE_KEY!,
    );
    this.configurado = true;
  }

  async enviar(destino: DestinoPush, aviso: AvisoPush): Promise<ResultadoPush> {
    if (!this.habilitado) {
      logger.info({ aviso }, '[sandbox] VAPID sin configurar — push simulado, no enviado');
      return 'ok';
    }

    this.configurar();

    try {
      await webpush.sendNotification(
        { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
        JSON.stringify(aviso),
        // TTL: si el teléfono está apagado, el servicio guarda el aviso este
        // tiempo. Media hora — "tu pedido está listo" cuatro horas después no
        // sirve, molesta.
        { TTL: 1800 },
      );
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: el navegador dio de baja esa suscripción (desinstaló, revocó
      // el permiso, limpió los datos). No es un error nuestro y no se
      // reintenta: hay que borrarla o se acumulan destinos muertos para siempre.
      if (status === 404 || status === 410) return 'muerta';

      logger.warn({ err, status }, 'Fallo al enviar push');
      return 'error';
    }
  }
}
