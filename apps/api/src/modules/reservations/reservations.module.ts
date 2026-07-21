import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationRemindersService } from './reservation-reminders.service';

@Module({
  // IntegrationsModule: NotificationsService para el recordatorio por los avisos.
  imports: [IntegrationsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationRemindersService],
})
export class ReservationsModule {}
