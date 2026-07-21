'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing, Check } from 'lucide-react';
import { activarPush, permisoPush, pushSoportado } from '@/lib/push';

/**
 * Botón para activar los avisos al teléfono.
 *
 * Es un BOTÓN y no un pedido automático al cargar a propósito. Pedir permiso
 * apenas entra alguien tiene una tasa de rechazo altísima, los navegadores lo
 * penalizan, y el rechazo es **definitivo**: si dice que no, no se le puede
 * volver a preguntar nunca desde el sitio. Se pide cuando la persona entiende
 * para qué sirve.
 */
export function ActivarAvisos({
  ruta,
  conAuth = false,
  texto = 'Avisame cuando esté listo',
}: {
  /** Endpoint de alta (ver `activarPush`). */
  ruta: string;
  conAuth?: boolean;
  texto?: string;
}) {
  const [estado, setEstado] = useState<'cargando' | 'oculto' | 'ofrecer' | 'activando' | 'activo'>('cargando');

  useEffect(() => {
    if (!pushSoportado()) {
      setEstado('oculto');
      return;
    }
    const permiso = permisoPush();
    // `denied`: ya dijo que no. Mostrar el botón sería mentirle — al tocarlo no
    // pasaría nada, porque el navegador ni siquiera muestra el cartel.
    if (permiso === 'denied') setEstado('oculto');
    else if (permiso === 'granted') setEstado('activo');
    else setEstado('ofrecer');
  }, []);

  // Ya tiene el permiso dado: se registra este dispositivo en silencio, sin
  // molestarlo con un botón que no necesita tocar.
  useEffect(() => {
    if (estado !== 'activo') return;
    void activarPush(ruta, conAuth);
  }, [estado, ruta, conAuth]);

  if (estado === 'cargando' || estado === 'oculto') return null;

  if (estado === 'activo') {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Check className="h-4 w-4 text-ok-foreground" aria-hidden="true" />
        Te vamos a avisar al teléfono
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={estado === 'activando'}
      onClick={async () => {
        setEstado('activando');
        const ok = await activarPush(ruta, conAuth);
        // Si no se pudo (dijo que no, o el navegador no quiso), se oculta en vez
        // de dejar un botón que ya no hace nada.
        setEstado(ok ? 'activo' : 'oculto');
      }}
      className="btn btn-primary min-h-[44px] w-full justify-center"
    >
      {estado === 'activando' ? (
        <>
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Activando...
        </>
      ) : (
        <>
          <Bell className="h-4 w-4" aria-hidden="true" />
          {texto}
        </>
      )}
    </button>
  );
}
