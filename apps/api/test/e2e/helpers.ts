import type { APIRequestContext } from '@playwright/test';

export const OWNER_CREDENTIALS = {
  email: process.env.E2E_OWNER_EMAIL ?? 'owner@chillberry-demo.test',
  password: process.env.E2E_OWNER_PASSWORD ?? 'Chillberry123!',
};

// Con `TURNSTILE_SECRET_KEY` en su default de sandbox (clave de prueba de
// Cloudflare que siempre aprueba), el valor de `response` es irrelevante —
// cualquier string llega a `success:true` en el siteverify real.
const TEST_TURNSTILE_TOKEN = 'e2e-test-token';

export async function login(
  request: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<string> {
  const res = await request.post('auth/login', {
    data: { ...credentials, turnstileToken: TEST_TURNSTILE_TOKEN },
  });
  if (!res.ok()) {
    throw new Error(`Login falló para ${credentials.email}: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Primera branch del tenant demo — asume que el seed ya corrió. */
export async function getFirstBranch(request: APIRequestContext, token: string) {
  const res = await request.get('branches', { headers: authHeader(token) });
  if (!res.ok()) throw new Error(`GET /branches falló: ${res.status()}`);
  const branches = (await res.json()) as { id: string; restaurantId: string }[];
  if (branches.length === 0) throw new Error('No hay branches — ¿corriste el seed?');
  return branches[0]!;
}

export async function getFirstMenuItem(request: APIRequestContext, token: string, branchId: string) {
  const res = await request.get('menu/items', { headers: authHeader(token), params: { branchId } });
  if (!res.ok()) throw new Error(`GET /menu/items falló: ${res.status()}`);
  const items = (await res.json()) as { id: string; name: string; price: string; isCombo?: boolean }[];
  if (items.length === 0) throw new Error('No hay menu items — ¿corriste el seed?');
  // Un combo es un MenuItem más, pero los tests que piden "el primer producto"
  // esperan un producto simple (con categoría, sin componentes) — saltearlos.
  return items.find((i) => !i.isCombo) ?? items[0]!;
}
