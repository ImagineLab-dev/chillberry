import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * Reportes/sugerencias de los restaurantes hacia Chillberry. Importa
 * `IntegrationsModule` por el `MailAdapter` (aviso a soporte@). Exporta el
 * service para que el `SuperAdminModule` pueda listarlos/gestionarlos.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
