import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { SubscriptionGuard } from './subscription.guard';

/**
 * Registra los guards globalmente, EN ORDEN:
 *   1. JwtAuthGuard      — autenticación (quién sos)
 *   2. RolesGuard        — autorización (qué rol te deja hacer)
 *   3. SubscriptionGuard — solo-lectura si la suscripción venció (402 en
 *      escrituras; ver subscription-estado.ts). Va último porque necesita
 *      `request.user` ya poblado por el primero.
 * Endpoints públicos se marcan con @Public() (common/decorators).
 */
@Global()
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class RbacModule {}
