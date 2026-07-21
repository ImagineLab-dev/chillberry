import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { FeedbackSurveyService } from './feedback-survey.service';

@Module({
  // IntegrationsModule: NotificationsService, para mandar el link por push.
  imports: [IntegrationsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackSurveyService],
})
export class FeedbackModule {}
