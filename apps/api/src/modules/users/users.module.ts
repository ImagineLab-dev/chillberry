import { Module } from '@nestjs/common';
// Por assertCanCreateUser: el límite de usuarios del plan se valida al crear.
import { BillingModule } from '../billing/billing.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [BillingModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
