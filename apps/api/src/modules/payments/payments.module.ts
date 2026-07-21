import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsController } from './payments.controller';
import { WebhooksController } from './webhooks.controller';
import { PaymentsService } from './payments.service';
import { MockPaymentAdapter } from './adapters/mock-payment.adapter';

// LoyaltyModule para acreditar puntos al cerrar un pedido. LoyaltyModule no
// importa PaymentsModule, así que no hay ciclo.
@Module({
  imports: [InvoicesModule, IntegrationsModule, LoyaltyModule, InventoryModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, MockPaymentAdapter],
  exports: [PaymentsService],
})
export class PaymentsModule {}
