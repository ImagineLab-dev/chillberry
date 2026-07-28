import { tokens } from './api-client';
import { decodeJwtPayload } from './jwt';

/**
 * "Entrar como" un tenant desde el super-admin. El backend devuelve un par de
 * tokens del dueño de ese restaurante; acá guardamos los tokens del super-admin
 * (para poder volver) y ponemos los del tenant. Al salir, se restauran.
 *
 * El estado (la vía de vuelta + el nombre del tenant) vive en `localStorage`, NO
 * en `sessionStorage`. Motivo: los tokens viven en cookies host-only COMPARTIDAS
 * entre todas las pestañas del host. Con el estado en `sessionStorage` (por
 * pestaña) el desajuste era real y peligroso: (a) una segunda pestaña usaba el
 * token del tenant impersonado pero NO mostraba el banner (su sessionStorage
 * estaba vacío), y (b) cerrar la pestaña sin "Salir" mataba la vía de vuelta pero
 * las cookies seguían vivas 30 días → super-admin varado como dueño del tenant
 * sin forma de volver salvo re-login. `localStorage` es del mismo scope que las
 * cookies (compartido entre pestañas del host, persiste al cerrar) y no viaja al
 * server, así que banner y vía de vuelta quedan siempre en sync con la sesión real.
 */
const KEY = 'cb_impersonation';

export type ImpersonationInfo = { tenantName: string };
type Saved = { tenantName: string; access: string; refresh: string; expiresIn: number };

/** Segundos que le quedan de vida a un access token (por su `exp`). El refresh
 *  cubre el resto, así que un mínimo de 60s alcanza para restaurar la sesión. */
function remainingSeconds(accessToken: string | null): number {
  if (!accessToken) return 60;
  const payload = decodeJwtPayload(accessToken) as { exp?: number } | null;
  if (!payload?.exp) return 60;
  return Math.max(60, payload.exp - Math.floor(Date.now() / 1000));
}

function readSaved(): Saved | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Saved;
  } catch {
    return null;
  }
}

export function startImpersonation(
  pair: { accessToken: string; refreshToken: string; expiresIn: number },
  info: ImpersonationInfo,
): void {
  const existing = readSaved();
  // Si YA se estaba impersonando, los tokens actuales son de un tenant, no del
  // super-admin: preservamos los que ya estaban guardados (la vía de vuelta) y
  // solo actualizamos el nombre. Sin esto, impersonar dos veces seguidas
  // enterraba la sesión del super-admin (había que re-loguear).
  const saved: Saved = existing
    ? { ...existing, tenantName: info.tenantName }
    : {
        tenantName: info.tenantName,
        access: tokens.getAccess() ?? '',
        refresh: tokens.getRefresh() ?? '',
        expiresIn: remainingSeconds(tokens.getAccess()),
      };
  localStorage.setItem(KEY, JSON.stringify(saved));
  tokens.set(pair.accessToken, pair.refreshToken, pair.expiresIn);
}

export function getImpersonation(): ImpersonationInfo | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return { tenantName: (JSON.parse(raw) as Saved).tenantName };
  } catch {
    return null;
  }
}

/** Restaura la sesión del super-admin. Devuelve false si no había impersonación. */
export function stopImpersonation(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as Saved;
    if (s.access && s.refresh) tokens.set(s.access, s.refresh, s.expiresIn);
    else tokens.clear();
  } catch {
    tokens.clear();
  }
  localStorage.removeItem(KEY);
  return true;
}
