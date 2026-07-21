import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { WebhooksBillingController } from './webhooks-billing.controller';
import { BillingService } from './billing.service';
import { MockDlocalAdapter } from './adapters/mock-dlocal.adapter';
import { DlocalGoAdapter } from './adapters/dlocal-go.adapter';
import { SUBSCRIPTION_PROVIDER } from './subscription-provider.token';
import { loadEnv } from '../../config/env';

@Module({
  controllers: [BillingController, WebhooksBillingController],
  providers: [
    BillingService,
    MockDlocalAdapter,
    DlocalGoAdapter,
    {
      // Mock por defecto; el adapter real de dLocal se activa con
      // BILLING_PROVIDER=dlocal (+ claves) — ver env.ts.
      provide: SUBSCRIPTION_PROVIDER,
      useFactory: (mock: MockDlocalAdapter, real: DlocalGoAdapter) =>
        loadEnv().BILLING_PROVIDER === 'dlocal' ? real : mock,
      inject: [MockDlocalAdapter, DlocalGoAdapter],
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
