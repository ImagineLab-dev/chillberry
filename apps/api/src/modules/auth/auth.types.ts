import type { UserRole } from '@chillberry/domain';

/** Lo que se inyecta en `request.user` después del JwtAuthGuard. */
export type AuthenticatedUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
};

/** Contenido del JWT access token. Mantener mínimo. */
export type JwtAccessPayload = {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
};
