import { api, tokens } from './api-client';
import { decodeJwtPayload } from './jwt';

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

export type MeResponse = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
};

/**
 * PASO 1 del alta: manda el código al correo. NO crea la cuenta todavía ni
 * devuelve sesión — el restaurante nace recién en `verifySignup`.
 */
export async function requestSignup(input: {
  tenantName: string;
  ownerName: string;
  email: string;
  password: string;
  countryCode?: string;
  turnstileToken: string;
}): Promise<void> {
  await api.post('/auth/register', { countryCode: 'PY', ...input }, { publicEndpoint: true });
}

/** PASO 2 del alta: con el código correcto se crea el restaurante y se entra. */
export async function verifySignup(email: string, code: string): Promise<TokenPair> {
  const result = await api.post<TokenPair>(
    '/auth/verify-signup',
    { email, code },
    { publicEndpoint: true },
  );
  tokens.set(result.accessToken, result.refreshToken, result.expiresIn);
  return result;
}

/** Pide el código para recuperar la cuenta. Responde igual exista o no. */
export async function requestPasswordReset(email: string, turnstileToken: string): Promise<void> {
  await api.post('/auth/forgot-password', { email, turnstileToken }, { publicEndpoint: true });
}

/** Cambia la contraseña con el código. Al volver, hay que loguearse de nuevo:
 *  el reset revoca todas las sesiones abiertas. */
export async function resetPassword(email: string, code: string, password: string): Promise<void> {
  await api.post('/auth/reset-password', { email, code, password }, { publicEndpoint: true });
}

export async function login(email: string, password: string, turnstileToken: string): Promise<TokenPair> {
  const result = await api.post<TokenPair>(
    '/auth/login',
    { email, password, turnstileToken },
    { publicEndpoint: true },
  );
  tokens.set(result.accessToken, result.refreshToken, result.expiresIn);
  return result;
}

export async function logout() {
  const refreshToken = tokens.getRefresh();
  if (refreshToken) {
    try {
      await api.post('/auth/logout', { refreshToken }, { publicEndpoint: true });
    } catch {
      // ignorar — limpiamos las cookies igual
    }
  }
  tokens.clear();
}

export function getCurrentUser() {
  return api.get<MeResponse>('/auth/me');
}

export function getCurrentClaims() {
  const access = tokens.getAccess();
  return access ? decodeJwtPayload(access) : null;
}
