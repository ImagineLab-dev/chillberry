import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { findDlocalCountry, USER_ROLE } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { loadEnv } from '../../config/env';
import { VerificationService } from './verification.service';
import { TurnstileService } from '../../common/turnstile/turnstile.service';
import { BillingService } from '../billing/billing.service';
import { JwtAccessPayload } from './auth.types';

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };
type RequestMeta = { userAgent?: string | null; ipAddress?: string | null };

const TRIAL_DAYS = 14;

// Anti-fuerza-bruta por cuenta: tras N fallos consecutivos, bloqueo temporal.
const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly billing: BillingService,
    private readonly turnstile: TurnstileService,
    private readonly verification: VerificationService,
  ) {}

  /**
   * PASO 1 del alta: valida, guarda el intento y manda un código por mail.
   *
   * NO crea nada todavía. El restaurante nace recién en `verifySignup`, cuando
   * el código vuelve correcto. El motivo es concreto: `register` crea un Tenant
   * con un `slug` que es ÚNICO EN TODO EL SISTEMA. Si se creara antes de
   * verificar, cualquier bot podría acaparar los slugs buenos ("pizzeria",
   * "sushi", "parrilla") sin tener siquiera un correo válido — y cada tipeo mal
   * dejaría un restaurante fantasma con su suscripción TRIAL corriendo.
   */
  async requestSignup(
    args: {
      tenantName: string;
      ownerName: string;
      email: string;
      password: string;
      countryCode: string;
      turnstileToken: string;
    },
    meta: RequestMeta,
  ): Promise<{ ok: true }> {
    await this.turnstile.verify(args.turnstileToken, meta.ipAddress);

    const email = args.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    // La contraseña se hashea ACÁ y viaja hasheada en el payload del código: la
    // contraseña en claro no se guarda en ningún lado ni un minuto.
    const passwordHash = await argon2.hash(args.password);

    await this.verification.emitir({
      email,
      purpose: 'SIGNUP',
      payload: {
        tenantName: args.tenantName,
        ownerName: args.ownerName,
        countryCode: args.countryCode,
        passwordHash,
      },
      asunto: 'Tu código para crear la cuenta',
      titulo: 'Creá tu cuenta',
      bajada: `Usá este código para terminar de crear la cuenta de ${args.tenantName}.`,
      siNoFuiste: 'Si no pediste crear una cuenta, ignorá este mensaje: no se creó nada.',
    });

    return { ok: true };
  }

  /**
   * PASO 2 del alta: con el código correcto, recién acá nace el restaurante
   * (Tenant + suscripción TRIAL + usuario OWNER) y se devuelve la sesión.
   */
  async verifySignup(
    args: { email: string; code: string },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const email = args.email.toLowerCase();

    // TODO LO QUE PUEDE FALLAR VA ANTES DE CONSUMIR EL CÓDIGO.
    //
    // Consumir es irreversible: el código queda quemado y no se puede reusar.
    // Si algo revienta después, el usuario se queda sin código Y sin cuenta,
    // sin nada que pueda hacer salvo pedir otro y gastar uno de los 5 por hora.
    //
    // Pasó de verdad en el primer alta real (21/07/2026): la base de producción
    // no tenía ningún plan cargado, así que la búsqueda del plan tiraba 404
    // DESPUÉS del consumo. La cuenta no se creaba y el código ya no servía.

    // Si no hay ningún plan activo configurado, esto falla ANTES de tocar el
    // código: el usuario puede reintentar el mismo código apenas se arregle.
    const defaultPlan = await this.billing.getDefaultPlan();

    const payload = (await this.verification.consumir({
      email,
      purpose: 'SIGNUP',
      codigo: args.code,
    })) as { tenantName: string; ownerName: string; countryCode: string; passwordHash: string } | null;

    if (!payload) throw new ConflictException('No encontramos el alta pendiente. Empezá de nuevo.');

    // El chequeo de email duplicado va DESPUÉS del consumo a propósito, aunque
    // queme el código: si la cuenta ya existe, el código ya no sirve para nada
    // igual. Adelantarlo haría que este endpoint público respondiera distinto
    // según si el email tiene cuenta o no — un oráculo para averiguar quién
    // está registrado.
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    const args2 = {
      tenantName: payload.tenantName,
      ownerName: payload.ownerName,
      countryCode: payload.countryCode,
    };
    const slug = await this.generateUniqueSlug(args2.tenantName);
    const passwordHash = payload.passwordHash;

    // `findDlocalCountry` no puede fallar acá: `RegisterDto.countryCode` ya
    // está validado contra la misma lista (`@IsIn(COUNTRY_CODES)`), pero el
    // fallback a PYG evita un 500 si algún día ese `@IsIn` se afloja.
    const currency = findDlocalCountry(args2.countryCode)?.currency ?? 'PYG';

    // Si la creación falla, se devuelve el código a su estado anterior. Sin
    // esto, cualquier error acá deja al usuario sin código y sin cuenta —
    // exactamente el agujero que apareció en el primer alta real.
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: args2.tenantName, slug, countryCode: args2.countryCode, currency },
        });
        // Fase 6: toda Tenant nueva arranca con una Subscription TRIAL en el
        // plan de entrada (el de `sortOrder` más bajo) — ver Fase 10 del plan
        // original ("POST /auth/register crea Tenant+OWNER+Subscription TRIAL").
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: defaultPlan.id,
            status: 'TRIAL',
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
          },
        });
        return tx.user.create({
          data: {
            tenantId: tenant.id,
            email,
            passwordHash,
            name: args2.ownerName,
            role: USER_ROLE.Owner,
          },
        });
      });
    } catch (err) {
      await this.verification.restaurar(email, 'SIGNUP');
      throw err;
    }

    return this.issueTokens(user, meta);
  }

  async login(
    args: { email: string; password: string; turnstileToken: string },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    // Se verifica ANTES de tocar la DB — falla rápido y barato contra
    // fuerza bruta/credential stuffing sin gastar una query por intento.
    await this.turnstile.verify(args.turnstileToken, meta.ipAddress);

    const user = await this.prisma.user.findUnique({ where: { email: args.email.toLowerCase() } });
    // Mismo error para email inexistente o password incorrecta — no enumerar
    // usuarios. Un email que no existe nunca entra a la lógica de lockout, así
    // que un atacante probando emails al azar no puede descubrir cuáles existen.
    if (!user || !user.active) throw new UnauthorizedException('Credenciales inválidas');

    // Anti-fuerza-bruta POR CUENTA (complementa el rate-limit por IP, que un
    // atacante distribuido con muchas IPs puede sortear): si la cuenta está
    // bloqueada, se rechaza sin siquiera verificar la contraseña.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new UnauthorizedException(
        `Cuenta bloqueada por demasiados intentos fallidos. Probá de nuevo en ${mins} min.`,
      );
    }

    const ok = await argon2.verify(user.passwordHash, args.password);
    if (!ok) {
      // Cuenta el fallo; al llegar al umbral, bloquea y reinicia el contador (el
      // bloqueo es la consecuencia; tras expirar arranca de cero otra vez).
      const attempts = user.failedLoginAttempts + 1;
      const willLock = attempts >= LOGIN_LOCK_THRESHOLD;
      await this.prisma.user.update({
        where: { id: user.id },
        data: willLock
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) }
          : { failedLoginAttempts: attempts },
      });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Éxito: limpiar cualquier rastro de fallos previos.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return this.issueTokens(user, meta);
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    // `login` valida `user.active`, pero esto NO lo hacía: como cada refresh
    // emite un token nuevo con vencimiento fresco, un empleado dado de baja
    // conservaba el acceso indefinidamente con sólo refrescar una vez por mes.
    // Un cajero despedido seguía cobrando, descontando y sacando plata de caja.
    if (!user.active) {
      throw new UnauthorizedException('Tu cuenta fue desactivada');
    }
    return this.issueTokens(user, meta);
  }

  /**
   * PASO 1 de la recuperación: manda un código al correo de la cuenta.
   *
   * SIEMPRE responde lo mismo, exista o no la cuenta. Si contestara distinto,
   * cualquiera podría averiguar qué correos son clientes tuyos probando de a
   * uno — una lista así se vende, y además sirve para dirigir phishing con tu
   * propia marca.
   */
  async requestPasswordReset(
    args: { email: string; turnstileToken: string },
    meta: RequestMeta,
  ): Promise<{ ok: true }> {
    await this.turnstile.verify(args.turnstileToken, meta.ipAddress);
    const email = args.email.toLowerCase();

    const user = await this.prisma.user.findUnique({ where: { email } });
    // Una cuenta desactivada tampoco recibe código: recuperarla no serviría de
    // nada porque el login la rechaza igual.
    if (user && user.active) {
      await this.verification.emitir({
        email,
        purpose: 'PASSWORD_RESET',
        asunto: 'Tu código para recuperar la cuenta',
        titulo: 'Recuperá tu cuenta',
        bajada: `Hola ${user.name}, usá este código para poner una contraseña nueva.`,
        siNoFuiste:
          'Si no pediste recuperar la cuenta, ignorá este mensaje: tu contraseña sigue siendo la misma.',
      });
    }

    return { ok: true };
  }

  /**
   * PASO 2 de la recuperación: con el código correcto, cambia la contraseña.
   *
   * Y revoca TODAS las sesiones abiertas: si alguien recupera la cuenta es
   * porque la perdió, y hay que asumir que quien se la quitó puede tener una
   * sesión viva. Cambiar la clave sin cortar sesiones no lo saca.
   */
  async resetPassword(args: { email: string; code: string; password: string }): Promise<{ ok: true }> {
    const email = args.email.toLowerCase();
    await this.verification.consumir({ email, purpose: 'PASSWORD_RESET', codigo: args.code });

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      throw new UnauthorizedException('No se pudo cambiar la contraseña de esta cuenta');
    }

    const passwordHash = await argon2.hash(args.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        // Se limpia el bloqueo por intentos fallidos: quien recuperó la cuenta
        // no tiene por qué quedar trabado por los intentos del que se la robó.
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    return { ok: true };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (session && !session.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, tenantId: true, email: true, name: true, role: true, phone: true },
    });
    return user;
  }

  // ----------------------------------------------------------------- helpers

  private async issueTokens(
    user: { id: string; tenantId: string; email: string; role: string; branchId?: string | null },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const payload: JwtAccessPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role as JwtAccessPayload['role'],
      branchId: user.branchId ?? null,
    };
    const accessToken = await this.jwt.signAsync(
      { ...payload },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL as unknown as number },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: computeExpiresAt(this.env.JWT_REFRESH_TTL),
      },
    });

    return { accessToken, refreshToken, expiresIn: parseTtlToSeconds(this.env.JWT_ACCESS_TTL) };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateUniqueSlug(tenantName: string): Promise<string> {
    // NFD + strip diacritical marks (U+0300-U+036F) para que "Café Central" -> "cafe-central".
    const diacritics = new RegExp(String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93), 'g');
    const base = tenantName
      .toLowerCase()
      .normalize('NFD')
      .replace(diacritics, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'restaurante';

    let slug = base;
    let attempt = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}

function computeExpiresAt(ttl: string): Date {
  return new Date(Date.now() + parseTtlToSeconds(ttl) * 1000);
}

function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const n = Number(match[1]);
  switch (match[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return 900;
  }
}
