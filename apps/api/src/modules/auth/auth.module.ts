import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BillingModule } from '../billing/billing.module';
import { TurnstileModule } from '../../common/turnstile/turnstile.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { VerificationService } from './verification.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), BillingModule, TurnstileModule, IntegrationsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, VerificationService],
  exports: [AuthService],
})
export class AuthModule {}
