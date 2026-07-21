import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module';
import { BillingModule } from '../billing/billing.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [KitchenModule, BillingModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
