/**
 * Cookies planas (no httpOnly) para que `middleware.ts` (Edge) pueda leer el
 * rol del JWT sin round-trip al API — la redirección por rol es solo UX, la
 * autorización real la hacen los guards de NestJS en cada request.
 *
 * En producción la cookie se setea a NIVEL DE DOMINIO (`Domain=.<root>`), así la
 * sesión se comparte entre el apex y los subdominios (p. ej. entrás en
 * `chillberry.app` y el panel de `super-admin.chillberry.app` te reconoce sin
 * re-loguear). En localhost/IP queda host-only, como siempre.
 *
 * Fase 8 (seguridad pre-producción): migrar a httpOnly + Secure vía un route
 * handler de Next que proxee /auth/* y setee Set-Cookie server-side.
 */
const RAW_ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '').split(':')[0];
// Sólo compartimos entre subdominios cuando hay un dominio real (prod). En
// `localhost` o una IP no se pone `Domain` (quedaría inservible) → host-only.
const SHARE_DOMAIN =
  RAW_ROOT && RAW_ROOT !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(RAW_ROOT) ? RAW_ROOT : null;
const DOMAIN_ATTR = SHARE_DOMAIN ? `; Domain=.${SHARE_DOMAIN}; Secure` : '';

export function setCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') return;
  // Migración: si quedó una cookie HOST-ONLY vieja del mismo nombre (de antes de
  // compartir por dominio), se borra ANTES para que no coexista con la nueva
  // compartida — dos cookies con el mismo nombre harían que `getCookie` lea la
  // equivocada. Sin `DOMAIN_ATTR` (dev) este borrado no aplica.
  if (DOMAIN_ATTR) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${DOMAIN_ATTR}`;
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function removeCookie(name: string) {
  if (typeof document === 'undefined') return;
  // Se borran las DOS variantes: la host-only (por si quedó una vieja) y la de
  // dominio. Un `Max-Age=0` sólo borra la cookie cuyo scope coincide exactamente.
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  if (DOMAIN_ATTR) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${DOMAIN_ATTR}`;
}
