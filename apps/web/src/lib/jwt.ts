import type { UserRole } from '@chillberry/domain';

export type JwtAccessClaims = {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
  exp: number;
};

/**
 * Decodifica el payload de un JWT SIN verificar la firma — usar solo para
 * decisiones de UX (qué layout mostrar, a dónde redirigir). La autorización
 * real siempre la valida el backend con la firma del token.
 *
 * `atob` (no Buffer) porque esto corre también en el middleware de Next
 * (Edge runtime).
 */
export function decodeJwtPayload(token: string): JwtAccessClaims | null {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json) as JwtAccessClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: JwtAccessClaims): boolean {
  return claims.exp * 1000 < Date.now();
}
