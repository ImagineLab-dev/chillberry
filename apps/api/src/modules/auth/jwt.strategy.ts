import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { loadEnv } from '../../config/env';
import { AuthenticatedUser, JwtAccessPayload } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const env = loadEnv();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.JWT_ACCESS_SECRET,
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtAccessPayload): AuthenticatedUser {
    if (!payload?.sub || !payload.tenantId) throw new UnauthorizedException();
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
      // `?? null` a propósito: los tokens emitidos ANTES de que existiera el
      // aislamiento por sucursal no traen el campo. Sin esto llegarían como
      // `undefined` y cualquier comparación contra una sucursal daría falso
      // de la manera equivocada.
      branchId: payload.branchId ?? null,
    };
  }
}
