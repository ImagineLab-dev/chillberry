import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { USER_ROLE } from '@chillberry/domain';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { strictThrottle } from '../../common/security/throttle.util';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';

@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  // --- Público (sin auth): lo abre el cliente desde el link del aviso. ---

  @Public()
  @Throttle(strictThrottle(30))
  @Get('public/feedback/:token')
  getByToken(@Param('token') token: string) {
    return this.feedback.getByToken(token);
  }

  // Escritura pública → throttle estricto (evita enumerar tokens a lo bruto).
  @Public()
  @Throttle(strictThrottle(10))
  @Post('public/feedback/:token')
  submit(@Param('token') token: string, @Body() dto: SubmitFeedbackDto) {
    return this.feedback.submit(token, dto);
  }

  // --- Dueño/admin: resultados agregados. ---

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('feedback')
  results(
    @BranchScope() branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.feedback.results(branchId || undefined, from, to);
  }
}
