import type { UserRole } from '@chillberry/domain';

/** Lo que se inyecta en `request.user` después del JwtAuthGuard. */
export type AuthenticatedUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  /**
   * Sucursal a la que está atado el empleado, o `null` si ve todo el
   * restaurante (el dueño). Viaja en el token para no pegarle a la base en cada
   * request; el precio es que reasignar de sucursal recién surte efecto cuando
   * el token se renueva (15 min como máximo).
   */
  branchId: string | null;
};

/** Contenido del JWT access token. Mantener mínimo. */
export type JwtAccessPayload = {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
  /** Sucursal del empleado; `null` = todas (ver AuthenticatedUser). */
  branchId: string | null;
};
