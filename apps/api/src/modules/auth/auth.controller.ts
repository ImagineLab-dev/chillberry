import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { strictThrottle } from '../../common/security/throttle.util';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AnyRole } from '../../common/decorators/any-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifySignupDto,
} from './dto/verification.dto';
import { RefreshDto } from './dto/refresh.dto';
import type { AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * PASO 1 del alta: manda el código y NO crea nada. El restaurante nace recién
   * en `/auth/verify-signup` — así un bot no puede acaparar slugs (que son
   * únicos en todo el sistema) sin un correo válido.
   */
  @Public()
  @Throttle(strictThrottle(5))
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.requestSignup(dto, meta(req));
  }

  /** PASO 2 del alta: con el código correcto se crea el restaurante y se entra. */
  @Public()
  @Throttle(strictThrottle(10))
  @Post('verify-signup')
  @HttpCode(HttpStatus.CREATED)
  async verifySignup(@Body() dto: VerifySignupDto, @Req() req: Request) {
    return this.auth.verifySignup(dto, meta(req));
  }

  /**
   * Recuperación: pedir el código. Responde igual exista o no la cuenta, para
   * no regalar una lista de qué correos son clientes.
   */
  @Public()
  @Throttle(strictThrottle(5))
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: RequestPasswordResetDto, @Req() req: Request) {
    return this.auth.requestPasswordReset(dto, meta(req));
  }

  /** Recuperación: con el código correcto, cambia la clave y corta las sesiones. */
  @Public()
  @Throttle(strictThrottle(10))
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Public()
  @Throttle(strictThrottle(5))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, meta(req));
  }

  @Public()
  @Throttle(strictThrottle(30))
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, meta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  // @AnyRole: es el bootstrap de sesión de CUALQUIER rol — `lib/auth.ts` del
  // front lo llama en todas las pantallas (admin, pos, waiter, kitchen,
  // driver) para saber quién es el usuario. Devuelve solo los datos del propio
  // usuario del JWT, así que no hay nada que un rol pueda ver de otro.
  @AnyRole()
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}

function meta(req: Request) {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
  };
}
