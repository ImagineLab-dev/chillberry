'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { playSound, type SoundKind } from '@/lib/beep';

/**
 * Sistema de notificaciones flotantes (toasts) para toda la app. Es la
 * contraparte VISUAL del sonido: cuando llega una acción a un área (pedido a
 * cocina, cuenta pedida en caja, entrega asignada al repartidor, etc.) se
 * muestra un pop-up efímero, opcionalmente con sonido.
 *
 * Se monta una sola vez en el layout raíz (`ToastProvider`) y cualquier
 * pantalla dispara notificaciones con `useToast().notify(...)`.
 */

type ToastTone = 'ok' | 'warn' | 'info' | 'error';

export type NotifyInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Si se pasa, reproduce ese sonido al aparecer. */
  sound?: SoundKind;
  /** ms hasta auto-cerrarse. Default 7000. `0` = no se cierra solo. */
  duration?: number;
};

type Toast = NotifyInput & { id: number; tone: ToastTone; createdAt: number };

const ToastContext = createContext<{ notify: (input: NotifyInput) => void } | null>(null);

const TONE_META: Record<ToastTone, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  ok: { cls: 'alert-ok', Icon: CheckCircle2 },
  warn: { cls: 'alert-warn', Icon: AlertTriangle },
  info: { cls: 'alert-info', Icon: Info },
  error: { cls: 'alert-error', Icon: XCircle },
};

const DEFAULT_DURATION = 7000;
// Tope de toasts a la vez: más que esto se vuelve ruido y tapa la pantalla.
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Contador monotónico para ids únicos. No usamos Date.now()/random para que
  // dos toasts disparados en el mismo tick no colisionen de id.
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (input: NotifyInput) => {
      const id = ++seq.current;
      const toast: Toast = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'info',
        sound: input.sound,
        duration: input.duration,
        createdAt: id,
      };
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), toast]);
      if (input.sound) playSound(input.sound);

      const duration = input.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  // Limpiar todos los timers al desmontar (evita callbacks tras unmount).
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {/* Contenedor fijo arriba a la derecha (full-width arriba en mobile).
          aria-live=polite: los lectores de pantalla anuncian sin robar foco. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-3 sm:inset-x-auto sm:right-0 sm:items-end"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => {
          const { cls, Icon } = TONE_META[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' || t.tone === 'warn' ? 'alert' : 'status'}
              className={clsx(
                'alert pointer-events-auto w-full max-w-sm animate-fade-in shadow-lg',
                cls,
              )}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm opacity-90">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
                aria-label="Cerrar notificación"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Hook para disparar notificaciones. Si el provider no está montado (no debería
 * pasar: está en el layout raíz), degrada a un no-op en vez de romper la página.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { notify: (_input: NotifyInput) => {} };
  }
  return ctx;
}
