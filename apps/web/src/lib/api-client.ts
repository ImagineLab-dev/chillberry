import { getCookie, removeCookie, setCookie } from './cookies';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const ACCESS_COOKIE = 'cb_access';
const REFRESH_COOKIE = 'cb_refresh';

let refreshInFlight: Promise<string | null> | null = null;

export type ApiError = { status: number; message: string; detail?: unknown };

export const tokens = {
  getAccess: () => getCookie(ACCESS_COOKIE),
  getRefresh: () => getCookie(REFRESH_COOKIE),
  set(access: string, refresh: string, expiresIn: number) {
    setCookie(ACCESS_COOKIE, access, expiresIn);
    setCookie(REFRESH_COOKIE, refresh, 60 * 60 * 24 * 30);
  },
  clear() {
    removeCookie(ACCESS_COOKIE);
    removeCookie(REFRESH_COOKIE);
  },
};

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = tokens.getRefresh();
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        tokens.clear();
        return null;
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
      tokens.set(data.accessToken, data.refreshToken, data.expiresIn);
      return data.accessToken;
    } catch {
      tokens.clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  publicEndpoint?: boolean;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.publicEndpoint) {
    const access = tokens.getAccess();
    if (access) headers.Authorization = `Bearer ${access}`;
  }

  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  let res = await fetch(url.toString(), init);

  if (res.status === 401 && !opts.publicEndpoint) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers.Authorization = `Bearer ${newAccess}`;
      res = await fetch(url.toString(), { ...init, headers });
    }
  }

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      // body vacío o no-JSON
    }
    const err: ApiError = {
      status: res.status,
      message: (errBody as { message?: string })?.message ?? res.statusText,
      detail: errBody,
    };
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Sube un archivo como multipart/form-data — separado de `request()` porque
 * ahí el `Content-Type: application/json` y el `JSON.stringify(body)` son
 * fijos. Nunca hay que setear `Content-Type` a mano acá: el browser arma el
 * boundary de multipart solo si el header se deja ausente.
 */
async function uploadFile(path: string, file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  const access = tokens.getAccess();
  if (access) headers.Authorization = `Bearer ${access}`;

  let res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: form });

  if (res.status === 401) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers.Authorization = `Bearer ${newAccess}`;
      res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: form });
    }
  }

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      // body vacío o no-JSON
    }
    const err: ApiError = {
      status: res.status,
      message: (errBody as { message?: string })?.message ?? res.statusText,
      detail: errBody,
    };
    throw err;
  }

  return (await res.json()) as { url: string };
}

export const api = {
  get<T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) {
    return request<T>(path, { ...opts, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method'> = {}) {
    return request<T>(path, { ...opts, method: 'POST', body });
  },
  patch<T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method'> = {}) {
    return request<T>(path, { ...opts, method: 'PATCH', body });
  },
  put<T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method'> = {}) {
    return request<T>(path, { ...opts, method: 'PUT', body });
  },
  delete<T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) {
    return request<T>(path, { ...opts, method: 'DELETE' });
  },
  uploadImage(file: File) {
    return uploadFile('/uploads/image', file);
  },
};
