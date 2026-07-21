import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Registra los guards globalmente. Orden: JwtAuthGuard (autenticación)
 * primero, RolesGuard (autorización) después. Endpoints públicos se marcan
 * con @Public() (common/decorators/public.decorator).
 */
@Global()
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class RbacModule {}
