import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { Prisma, type VerificationPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailAdapter } from '../integrations/mail/mail.adapter';
import { mailDeCodigo } from '../integrations/mail/mail.templates';
import { logger } from '../../common/logging/logger';

/** Minutos que vive un código. Corto: es un dato que el usuario tiene a mano. */
const VIGENCIA_MINUTOS = 15;
/**
 * Intentos antes de matar el código. Seis dígitos son 1.000.000 de
 * combinaciones: sin tope, un script las prueba todas en minutos.
 */
const MAX_INTENTOS = 5;
/**
 * Cuántos códigos se pueden pedir por email en una hora. El límite por IP del
 * throttler global no alcanza: sin esto, cualquiera usa el sistema para
 * bombardear de mails a una persona rotando IPs.
 */
const MAX_ENVIOS_POR_HORA = 5;

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailAdapter,
  ) {}

  /**
   * Genera un código, lo manda por mail y guarda SÓLO su hash.
   *
   * Que se guarde hasheado no es ceremonia: quien pueda leer la base (un dump,
   * un backup filtrado, un empleado con acceso) no puede verificar cuentas
   * ajenas ni resetear contraseñas. Misma lógica que el código de entrega.
   */
  async emitir(args: {
    email: string;
    purpose: VerificationPurpose;
    payload?: Prisma.InputJsonValue;
    asunto: string;
    titulo: string;
    bajada: string;
    siNoFuiste: string;
  }): Promise<void> {
    const email = args.email.toLowerCase();

    const desde = new Date(Date.now() - 60 * 60 * 1000);
    const enviadosRecientes = await this.prisma.verificationCode.count({
      where: { email, purpose: args.purpose, createdAt: { gte: desde } },
    });
    if (enviadosRecientes >= MAX_ENVIOS_POR_HORA) {
      // Nest de esta versión no trae `TooManyRequestsException`: se arma el 429
      // a mano para que el front reciba el mismo código que usa el throttler.
      throw new HttpException(
        'Ya pedimos varios códigos para este correo. Esperá una hora o revisá tu carpeta de spam.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Los códigos anteriores del mismo tipo se invalidan: si no, quedarían
    // varios vivos a la vez y cada uno sumaría intentos por su cuenta.
    await this.prisma.verificationCode.updateMany({
      where: { email, purpose: args.purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // `randomInt` y no `Math.random()`: el segundo es predecible y acá el
    // número ES la credencial.
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const registro = await this.prisma.verificationCode.create({
      data: {
        email,
        purpose: args.purpose,
        codeHash: hashear(codigo),
        payload: args.payload,
        expiresAt: new Date(Date.now() + VIGENCIA_MINUTOS * 60 * 1000),
      },
    });

    const { html, text } = mailDeCodigo({
      titulo: args.titulo,
      bajada: args.bajada,
      codigo,
      vigenciaMinutos: VIGENCIA_MINUTOS,
      siNoFuiste: args.siNoFuiste,
    });

    try {
      await this.mail.send({ to: email, subject: args.asunto, text, html });
    } catch (err) {
      // El código se guarda ANTES de enviar (si no, un envío exitoso con la
      // escritura fallida dejaría al usuario con un código que no existe). Pero
      // si el envío falla, ese código quedó huérfano: nadie lo recibió y sin
      // esto seguiría contando contra el tope de 5 por hora, dejando al usuario
      // sin poder reintentar.
      await this.prisma.verificationCode.deleteMany({ where: { id: registro.id } });

      // El detalle real va al log; al usuario se le dice algo accionable. Antes
      // este error subía crudo y el front mostraba "Internal server error", que
      // no le dice a nadie qué hacer.
      logger.error({ err, purpose: args.purpose }, 'No se pudo enviar el mail con el código');
      throw new ServiceUnavailableException(
        'No pudimos enviar el correo en este momento. Probá de nuevo en unos minutos.',
      );
    }
  }

  /**
   * Valida el código y lo consume. Devuelve el `payload` guardado al emitirlo.
   *
   * Un código sólo sirve una vez: se marca consumido en la misma operación que
   * lo valida, así dos peticiones simultáneas con el mismo código no pueden
   * crear dos cuentas.
   */
  async consumir(args: {
    email: string;
    purpose: VerificationPurpose;
    codigo: string;
  }): Promise<Prisma.JsonValue | null> {
    const email = args.email.toLowerCase();

    const registro = await this.prisma.verificationCode.findFirst({
      where: { email, purpose: args.purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // Mensaje único para "no existe", "vencido" y "código equivocado": si cada
    // caso dijera algo distinto, se podría averiguar qué correos tienen un alta
    // pendiente probando de a uno.
    const invalido = () => new BadRequestException('El código no es válido o ya venció. Pedí uno nuevo.');

    if (!registro) throw invalido();
    if (registro.expiresAt < new Date()) throw invalido();
    if (registro.attempts >= MAX_INTENTOS) throw invalido();

    if (registro.codeHash !== hashear(args.codigo)) {
      await this.prisma.verificationCode.update({
        where: { id: registro.id },
        data: { attempts: { increment: 1 } },
      });
      // Al agotar los intentos el código muere, aunque todavía no haya vencido.
      if (registro.attempts + 1 >= MAX_INTENTOS) {
        await this.prisma.verificationCode.update({
          where: { id: registro.id },
          data: { consumedAt: new Date() },
        });
        logger.warn({ email, purpose: args.purpose }, 'Código de verificación agotado por intentos fallidos');
      }
      throw invalido();
    }

    // Consumo con guarda en la misma sentencia: si dos peticiones llegan juntas
    // con el código correcto, sólo una lo consume y la otra ve un código usado.
    const consumido = await this.prisma.verificationCode.updateMany({
      where: { id: registro.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumido.count === 0) throw invalido();

    return registro.payload;
  }
}

/**
 * SHA-256 alcanza acá y argon2 sería un error: el código vive 15 minutos, tiene
 * tope de intentos y se compara en cada verificación. Un hash lento sólo
 * agregaría latencia y una vía de saturación por CPU.
 */
function hashear(codigo: string): string {
  return createHash('sha256').update(codigo).digest('hex');
}
