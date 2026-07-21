import { Module } from '@nestjs/common';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';
import { SystemTenantGuard } from './system-tenant.guard';

/**
 * No importa `PrismaModule`: es `@Global()` (ver prisma.module.ts), así que
 * `PrismaService` ya está disponible. No exporta nada — ningún otro módulo
 * debería poder inyectar un service que lee cross-tenant.
 */
@Module({
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SystemTenantGuard],
})
export class SuperAdminModule {}
