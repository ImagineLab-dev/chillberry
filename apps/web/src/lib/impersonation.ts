import { tokens } from './api-client';
import { decodeJwtPayload } from './jwt';

/**
 * "Entrar como" un tenant desde el super-admin. El backend devuelve un par de
 * tokens del dueño de ese restaurante; acá guardamos los tokens del super-admin
 * (para poder volver) y ponemos los del tenant. Al salir, se restauran.
 *
 * Todo vive en `sessionStorage` (por pestaña): abrir el panel del tenant en la
 * misma pestaña reemplaza la sesión; cerrar la pestaña la descarta. La sesión
 * real sigue en las cookies `cb_access`/`cb_refresh` que maneja api-client.
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

export function startImpersonation(
  pair: { accessToken: string; refreshToken: string; expiresIn: number },
  info: ImpersonationInfo,
): void {
  const saved: Saved = {
    tenantName: info.tenantName,
    access: tokens.getAccess() ?? '',
    refresh: tokens.getRefresh() ?? '',
    expiresIn: remainingSeconds(tokens.getAccess()),
  };
  sessionStorage.setItem(KEY, JSON.stringify(saved));
  tokens.set(pair.accessToken, pair.refreshToken, pair.expiresIn);
}

export function getImpersonation(): ImpersonationInfo | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(KEY);
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
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as Saved;
    if (s.access && s.refresh) tokens.set(s.access, s.refresh, s.expiresIn);
    else tokens.clear();
  } catch {
    tokens.clear();
  }
  sessionStorage.removeItem(KEY);
  return true;
}
