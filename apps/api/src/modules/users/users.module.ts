import { Module } from '@nestjs/common';
// Por assertCanCreateUser: el límite de usuarios del plan se valida al crear.
import { BillingModule } from '../billing/billing.module';
// Por el mail de invitación al equipo (MailAdapter).
import { IntegrationsModule } from '../integrations/integrations.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [BillingModule, IntegrationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
