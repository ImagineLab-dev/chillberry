'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from './theme-provider';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
// Clave de prueba pública de Cloudflare (siempre aprueba) — sirve para
// desarrollar sin cuenta propia. Reemplazar con NEXT_PUBLIC_TURNSTILE_SITE_KEY
// antes de producción (ver .env).
const TEST_SITE_KEY = '1x00000000000000000000AA';
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? TEST_SITE_KEY;

// Con la clave de prueba, la clave SECRETA del backend acepta cualquier token.
// Así que si el widget no llega a resolver (típico en local: sin acceso a
// challenges.cloudflare.com, o bloqueado por firewall/adblock), entregamos un
// token cualquiera para no dejar el login trabado. En producción, con una
// clave real seteada, esto NO aplica: el widget es obligatorio.
const USING_TEST_KEY = SITE_KEY === TEST_SITE_KEY;
const DEV_FALLBACK_TOKEN = 'dev-local-turnstile-bypass';

/**
 * ¿Se puede usar el token de bypass? SÓLO fuera de producción.
 *
 * El fallback existe para que el login no quede trabado en local cuando el
 * widget no resuelve (sin acceso a challenges.cloudflare.com, adblock, etc.).
 * En un build de producción sería un agujero: cualquiera manda ese string y se
 * saltea el bot-check.
 *
 * La protección REAL es del lado del servidor: la API no arranca en producción
 * si `TURNSTILE_SECRET_KEY` sigue en el default de sandbox (ver `INSECURE_DEFAULTS`
 * en `apps/api/src/config/env.ts`), y esa clave el cliente no la puede tocar.
 * Esto de acá es la mitad del front: si alguien configuró el secreto pero se
 * olvidó de la clave de sitio, el widget falla a la vista en vez de dejar pasar
 * un token trucho en silencio.
 */
const PERMITE_BYPASS = USING_TEST_KEY && process.env.NODE_ENV !== 'production';

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar la verificación de seguridad'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Widget de bot-check (Cloudflare Turnstile). `onVerify('')` en expired/error
 * limpia el token del formulario para que el submit vuelva a quedar bloqueado
 * hasta que el usuario resuelva el widget de nuevo.
 *
 * El tema sigue al de la app, NO al del sistema operativo: con `'auto'` (el
 * default de Cloudflare) aparecía un widget blanco sobre una UI oscura cuando
 * el usuario elegía un tema distinto al de su SO.
 */
export function Turnstile({ onVerify, theme }: { onVerify: (token: string) => void; theme?: 'light' | 'dark' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const resolvedRef = useRef(false);
  const { theme: appTheme } = useTheme();
  const resolvedTheme = theme ?? appTheme;

  useEffect(() => {
    let cancelled = false;
    resolvedRef.current = false;

    const emit = (token: string) => {
      resolvedRef.current = token !== '';
      onVerifyRef.current(token);
    };

    // Red de seguridad para dev: si en unos segundos el widget no resolvió
    // (script no cargó / no completó), entregamos el token de bypass. Solo con
    // la clave de prueba; con clave real el widget manda.
    const fallback = PERMITE_BYPASS
      ? setTimeout(() => {
          if (!cancelled && !resolvedRef.current) emit(DEV_FALLBACK_TOKEN);
        }, 2500)
      : undefined;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme: resolvedTheme,
          callback: (token) => emit(token),
          'expired-callback': () => emit(''),
          'error-callback': () => {
            // Si el widget falla y estamos en dev, no bloquees el login.
            if (PERMITE_BYPASS) emit(DEV_FALLBACK_TOKEN);
            else emit('');
          },
        });
      })
      .catch(() => {
        // El script no cargó (sin red / bloqueado). En dev, seguimos igual.
        if (!cancelled && PERMITE_BYPASS) emit(DEV_FALLBACK_TOKEN);
      });

    return () => {
      cancelled = true;
      if (fallback) clearTimeout(fallback);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // `resolvedTheme` en deps: el widget se re-renderiza al cambiar de tema.
  }, [resolvedTheme]);

  return <div ref={containerRef} />;
}
