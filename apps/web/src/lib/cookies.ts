/**
 * Cookies planas (no httpOnly) para que `middleware.ts` (Edge) pueda leer el
 * rol del JWT sin round-trip al API — la redirección por rol es solo UX, la
 * autorización real la hacen los guards de NestJS en cada request.
 *
 * Fase 8 (seguridad pre-producción): migrar a httpOnly + Secure vía un route
 * handler de Next que proxee /auth/* y setee Set-Cookie server-side.
 */
export function setCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function removeCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}
