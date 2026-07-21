import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '../../../config/env';
import { logger } from '../../../common/logging/logger';

/**
 * Envío de mail por SMTP (códigos de alta y de recuperación de cuenta).
 *
 * Sin `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` cae en modo sandbox: loguea el
 * mensaje —incluido el código— en vez de enviarlo. Así el flujo completo se
 * prueba en local y en los tests sin casilla configurada, con el mismo criterio
 * que los adapters de WhatsApp y de pagos.
 *
 * En producción el arranque avisa si esto quedó en sandbox (ver
 * `warnSandboxEnProduccion` en config/env.ts): sin envío real, nadie puede
 * crear ni recuperar una cuenta.
 */
@Injectable()
export class MailAdapter {
  private transporter: Transporter | null = null;

  /** ¿Hay credenciales para enviar de verdad? */
  get configurado(): boolean {
    const env = loadEnv();
    // `MAIL_SANDBOX=true` gana sobre las credenciales: es el interruptor que usa
    // la suite e2e para no mandar mails de verdad a direcciones de prueba.
    if (env.MAIL_SANDBOX === 'true') return false;
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
  }

  async send(input: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    const env = loadEnv();

    if (!this.configurado) {
      // El cuerpo va al log a propósito: es la única forma de completar el
      // flujo en desarrollo. Por eso mismo NUNCA debe quedar así en producción.
      logger.info(
        { to: input.to, subject: input.subject, body: input.text },
        '[sandbox] SMTP no configurado — mail simulado, no enviado',
      );
      return;
    }

    // Una sola conexión reutilizada: abrir un socket SMTP por mail es lento y
    // muchos proveedores lo penalizan como comportamiento sospechoso.
    this.transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 es SMTPS (TLS desde el saludo); 587 arranca en claro y sube a TLS
      // con STARTTLS. Elegir mal deja la conexión colgada sin error claro.
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
    });

    // El `from` cae a SMTP_USER si no se configuró: la mayoría de los servidores
    // rechaza enviar con un remitente distinto de la casilla autenticada.
    const from = `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM ?? env.SMTP_USER}>`;

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    } catch (err) {
      // Se loguea sin el cuerpo: si falla el envío de un código, el código no
      // tiene por qué quedar en los logs de error.
      logger.error({ err, to: input.to, subject: input.subject }, 'Fallo al enviar mail');
      throw err;
    }
  }
}
