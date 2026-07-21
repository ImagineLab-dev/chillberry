import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  // IntegrationsModule: NotificationsService, para mandar la campaña por push.
  imports: [IntegrationsModule],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
