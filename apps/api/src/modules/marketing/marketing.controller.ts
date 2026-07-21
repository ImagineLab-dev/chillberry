import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MarketingService, type SegmentKey } from './marketing.service';
import { SendCampaignDto } from './dto/send-campaign.dto';

// Marketing es del dueño/admin (base de clientes + envíos).
@Roles(USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('segments')
  segments() {
    return this.marketing.segments();
  }

  @Get('segments/:key/customers')
  segmentCustomers(@Param('key') key: SegmentKey) {
    return this.marketing.segmentCustomers(key);
  }

  @Post('campaigns')
  send(@Body() dto: SendCampaignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.marketing.sendCampaign(dto.segment, dto.message, user.id);
  }

  @Get('campaigns')
  campaigns() {
    return this.marketing.listCampaigns();
  }
}
